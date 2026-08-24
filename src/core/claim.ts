/**
 * Checking a disclosure against the chain.
 *
 * Three roles, kept separate because collapsing them hides real cases:
 *
 *   Holder        whose payment history is being disclosed
 *   Counterparty  the address the disclosed relationship is with
 *   Verifier      whoever is asking to see it
 *
 * The Counterparty and the Verifier are usually different people. An employer
 * pays Alice privately; a landlord asks Alice to prove that income. Alice is
 * the Holder, the employer is the Counterparty, the landlord is the Verifier,
 * and the employer never participates in the disclosure at all.
 *
 * Two things make a claim sound.
 *
 * **Identity binding.** A channel key on its own proves only that notes exist
 * at some storage locations. `channel_exists(channel_marker)` is a public view,
 * and the marker covers the channel key plus both addresses and the recipient's
 * registered public key, so if the pool says it exists, the pool is attesting
 * that this key belongs to that pair in that direction.
 *
 * **The snapshot boundary.** Verification reads exactly the notes the Holder
 * authorized, indices 0..noteCount-1, and never walks past them. Payments that
 * arrive later sit at higher indices: they cannot join the authorized set, and
 * they cannot break it either.
 */

import {
  type Felt,
  computeChannelMarker,
  computeSubchannelMarker,
  toFelt,
} from "./derive";
import { type NoteReader, type ReadNote, countNotes, scanRange, totalAmount } from "./read";
import type { Disclosure } from "./bundle";

export type Direction = "outbound" | "inbound";

export type RelationshipScope = {
  holder: string;
  counterparty: string;
  token: string;
};

/** The key material a disclosure hands over, per lane. Reusable. */
export type LaneKeys = {
  /** Holder paid Counterparty. */
  outbound?: string;
  /** Counterparty paid Holder. */
  inbound?: string;
};

export type VerifiedLane = {
  direction: Direction;
  /** Exactly the authorized notes. Never more. */
  notes: ReadNote[];
  total: bigint;
  /** Notes now sitting past the authorized boundary. Not part of the claim. */
  laterNoteCount: number;
};

export type DisclosureFailure =
  | "no-lanes"
  | "unregistered-holder"
  | "unregistered-counterparty"
  | "lane-not-in-pool"
  | "asset-not-in-lane"
  | "missing-note"
  | "lane-total-mismatch"
  | "total-mismatch"
  | "empty-snapshot";

export type DisclosureResult = {
  verified: boolean;
  failure?: DisclosureFailure;
  /** Plain sentence, safe to show a Verifier who is not a developer. */
  reason: string;
  lanes: VerifiedLane[];
  total: bigint;
  /** True once the pool has confirmed every supplied key belongs to this pair. */
  identityBound: boolean;
  /**
   * Payments exist in this relationship that the Holder did not authorize.
   *
   * They are excluded from every figure above. A Verifier holding the reusable
   * channel key could read them independently, which is why this is surfaced
   * rather than hidden: the UI must show them as later activity, never as
   * Holder-approved history.
   */
  laterActivityDetected: boolean;
};

function fail(
  failure: DisclosureFailure,
  reason: string,
  extra: Partial<DisclosureResult> = {},
): DisclosureResult {
  return {
    verified: false,
    failure,
    reason,
    lanes: [],
    total: 0n,
    identityBound: false,
    laterActivityDetected: false,
    ...extra,
  };
}

/**
 * Verify the authorized snapshot of a relationship disclosure.
 *
 * Every read is a public view, so a Verifier needs no wallet, no account and no
 * permission from anyone.
 *
 * This checks the disclosure against the pool. It does **not** check the
 * on-chain authorization or its status: that is `registry.ts`, and a complete
 * verification runs both.
 */
export async function verifyDisclosure(
  reader: NoteReader,
  disclosure: Disclosure,
): Promise<DisclosureResult> {
  const { holder, counterparty, token } = disclosure.scope;
  const keys = disclosure.keys;

  if (!keys.outbound && !keys.inbound) {
    return fail("no-lanes", "This disclosure contains no payment relationship to check.");
  }

  // Both public keys come from the pool, never from the disclosure, so a
  // forged disclosure cannot supply its own.
  const holderPublicKey = await reader.getPublicKey(holder);
  const counterpartyPublicKey = await reader.getPublicKey(counterparty);

  if (keys.inbound && holderPublicKey === 0n) {
    return fail(
      "unregistered-holder",
      `${short(holder)} has never registered with the pool, so nobody could have paid them privately.`,
    );
  }
  if (keys.outbound && counterpartyPublicKey === 0n) {
    return fail(
      "unregistered-counterparty",
      `${short(counterparty)} has never registered with the pool, so no payment to them could exist.`,
    );
  }

  const lanes: VerifiedLane[] = [];

  for (const direction of ["outbound", "inbound"] as const) {
    const channelKey = keys[direction];
    if (!channelKey) continue;

    const lane = disclosure.snapshot[direction];
    if (!lane) {
      return fail(
        "empty-snapshot",
        `The disclosure includes a ${direction} key but no snapshot boundary for it, so there is nothing well defined to verify.`,
      );
    }

    const sender = direction === "outbound" ? holder : counterparty;
    const recipient = direction === "outbound" ? counterparty : holder;
    const recipientPublicKey =
      direction === "outbound" ? counterpartyPublicKey : holderPublicKey;

    const marker = computeChannelMarker(channelKey, sender, recipient, recipientPublicKey);
    if (!(await reader.channelExists(marker))) {
      return fail(
        "lane-not-in-pool",
        `The pool has no ${direction} payment lane from ${short(sender)} to ${short(
          recipient,
        )} matching this key.`,
      );
    }

    const subMarker = computeSubchannelMarker(channelKey, recipient, recipientPublicKey, token);
    if (lane.noteCount > 0 && !(await reader.subchannelExists(subMarker))) {
      return fail(
        "asset-not-in-lane",
        `That relationship exists, but the pool holds nothing for it in this asset.`,
        { identityBound: true },
      );
    }

    // Exactly the authorized range. Never a note more.
    const { notes, missingIndex } = await scanRange(reader, channelKey, token, lane.noteCount);
    if (missingIndex !== undefined) {
      return fail(
        "missing-note",
        `This disclosure claims ${lane.noteCount} ${direction} payments, but payment ${
          missingIndex + 1
        } is not in the pool.`,
        { identityBound: true },
      );
    }

    const total = totalAmount(notes);
    if (total !== BigInt(lane.total)) {
      return fail(
        "lane-total-mismatch",
        `The ${direction} payments total ${total} on chain, and this disclosure claims ${lane.total}.`,
        { identityBound: true },
      );
    }

    // Look one index past the boundary. Cheap, and it is the whole basis of the
    // "later activity" distinction.
    const nowCount = await countNotes(reader, channelKey, token, lane.noteCount + 64);
    lanes.push({
      direction,
      notes,
      total,
      laterNoteCount: Math.max(0, nowCount - lane.noteCount),
    });
  }

  const total = lanes.reduce((sum, l) => sum + l.total, 0n);
  const laterActivityDetected = lanes.some((l) => l.laterNoteCount > 0);
  const base = { lanes, total, identityBound: true, laterActivityDetected };

  if (total !== BigInt(disclosure.assertedTotal)) {
    return fail(
      "total-mismatch",
      `The authorized payments total ${total} on chain, and this disclosure claims ${disclosure.assertedTotal}.`,
      base,
    );
  }

  return { verified: true, reason: describe(lanes, holder, counterparty), ...base };
}

function describe(lanes: VerifiedLane[], holder: string, counterparty: string): string {
  const parts = lanes
    .filter((l) => l.notes.length > 0)
    .map(
      (l) =>
        `${l.notes.length} ${l.direction === "inbound" ? "received" : "sent"} totalling ${l.total}`,
    );
  return `The pool confirms the authorized payments between ${short(holder)} and ${short(
    counterparty,
  )}: ${parts.join(", ")}.`;
}

/**
 * Warnings the Holder must see before approving, and the Verifier must see
 * when reading.
 *
 * Centralised here so no interface can invent softer wording. Every sentence is
 * something the implementation actually does or actually cannot do.
 */
export const WARNINGS = {
  bearer:
    "This disclosure is a bearer credential. Anyone who receives this link or bundle can inspect the information it contains.",
  revocation:
    "Revoking the disclosure changes its authorization status. It cannot erase information or channel keys already received.",
  reusableKey:
    "The key in this disclosure keeps working. Whoever holds it can read this relationship later, including payments made after today.",
  relationshipScope:
    "A disclosure covers the whole relationship with this address for this asset. It cannot be narrowed to a single payment.",
  noAbsenceProof:
    "This proves the payments it shows happened. It cannot prove that other payments did not.",
  noProvenDates:
    "Lens does not filter by date. Any period mentioned in the request is context from the requester, not a cryptographic constraint.",
} as const;

/** What a Holder is about to reveal, in plain words, before they approve. */
export function exposure(
  lanes: { direction: Direction; noteCount: number }[],
  asked?: { noteCount?: number },
): string[] {
  const warnings: string[] = [];
  const total = lanes.reduce((n, l) => n + l.noteCount, 0);

  if (asked?.noteCount !== undefined && total > asked.noteCount) {
    warnings.push(
      `The requester asked about ${asked.noteCount} payment${
        asked.noteCount === 1 ? "" : "s"
      }, and this relationship contains ${total}. Approving reveals all ${total}.`,
    );
  }

  if (lanes.filter((l) => l.noteCount > 0).length === 2) {
    warnings.push(
      "Both directions are included: payments you received from this address and payments you sent to it.",
    );
  }

  warnings.push(WARNINGS.relationshipScope, WARNINGS.bearer, WARNINGS.reusableKey);
  return warnings;
}

function short(addr: Felt): string {
  const hex = "0x" + toFelt(addr).toString(16).padStart(64, "0");
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}
