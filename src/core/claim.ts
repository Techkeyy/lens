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
 * The subtle part is identity. A channel key on its own proves only that notes
 * exist at some storage locations; it says nothing about who paid whom, since
 * `channel_key = h(TAG, sender, sender_viewing_key, recipient, recipient_pub)`
 * cannot be inverted and the Verifier holds no keys.
 *
 * The pool closes that gap. `channel_exists(channel_marker)` is a public view,
 * and the marker is computed from the channel key plus both addresses and the
 * recipient's registered public key. If the pool says that marker exists, the
 * pool is attesting that this key belongs to that exact pair, in that
 * direction. That is what makes a claim sound without a circuit.
 */

import {
  type Felt,
  computeChannelMarker,
  computeSubchannelMarker,
  toFelt,
} from "./derive";
import { type NoteReader, type ReadNote, scanSubchannel, totalAmount } from "./read";

export type Direction = "outbound" | "inbound";

/** One relationship, one asset. Both lanes are optional but at least one is required. */
export type RelationshipScope = {
  holder: string;
  counterparty: string;
  token: string;
};

/** The key material a disclosure actually hands over, per lane. */
export type LaneKeys = {
  /** Holder paid Counterparty. */
  outbound?: string;
  /** Counterparty paid Holder. */
  inbound?: string;
};

export type VerifiedLane = {
  direction: Direction;
  notes: ReadNote[];
  total: bigint;
};

export type DisclosureFailure =
  | "no-lanes"
  | "unregistered-holder"
  | "unregistered-counterparty"
  | "lane-not-in-pool"
  | "no-notes"
  | "total-mismatch";

export type DisclosureResult = {
  verified: boolean;
  failure?: DisclosureFailure;
  /** Plain sentence, safe to show a Verifier who is not a developer. */
  reason: string;
  lanes: VerifiedLane[];
  total: bigint;
  /** True once the pool has confirmed every supplied key belongs to this pair. */
  identityBound: boolean;
};

function fail(
  failure: DisclosureFailure,
  reason: string,
  extra: Partial<DisclosureResult> = {},
): DisclosureResult {
  return { verified: false, failure, reason, lanes: [], total: 0n, identityBound: false, ...extra };
}

/**
 * Ask the pool to confirm a key belongs to a named sender and recipient.
 *
 * This is the step that turns "some notes exist" into "these are payments
 * between these two addresses". Without it, anyone could fund a lane of their
 * own and present it as someone else's payment.
 */
async function laneIsReal(
  reader: NoteReader,
  channelKey: Felt,
  sender: Felt,
  recipient: Felt,
  recipientPublicKey: bigint,
): Promise<boolean> {
  const marker = computeChannelMarker(channelKey, sender, recipient, recipientPublicKey);
  return reader.channelExists(marker);
}

/**
 * Verify a relationship disclosure, one or both directions.
 *
 * Every read here is a public view, so a Verifier needs no wallet, no account
 * and no permission from anyone.
 */
export async function verifyDisclosure(
  reader: NoteReader,
  scope: RelationshipScope,
  keys: LaneKeys,
  assertedTotal: bigint,
): Promise<DisclosureResult> {
  const { holder, counterparty, token } = scope;

  if (!keys.outbound && !keys.inbound) {
    return fail("no-lanes", "This disclosure contains no payment relationship to check.");
  }

  // Both public keys are read from the pool, never taken from the disclosure,
  // so a forged disclosure cannot supply its own.
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

    const sender = direction === "outbound" ? holder : counterparty;
    const recipient = direction === "outbound" ? counterparty : holder;
    const recipientPublicKey =
      direction === "outbound" ? counterpartyPublicKey : holderPublicKey;

    if (!(await laneIsReal(reader, channelKey, sender, recipient, recipientPublicKey))) {
      return fail(
        "lane-not-in-pool",
        `The pool has no ${direction} payment lane from ${short(sender)} to ${short(
          recipient,
        )} matching this key.`,
      );
    }

    const subMarker = computeSubchannelMarker(channelKey, recipient, recipientPublicKey, token);
    if (!(await reader.subchannelExists(subMarker))) {
      // A registered lane holding nothing in this asset is a real state, not a
      // failure. Record it as empty and carry on to the other direction.
      lanes.push({ direction, notes: [], total: 0n });
      continue;
    }

    const notes = await scanSubchannel(reader, channelKey, token);
    lanes.push({ direction, notes, total: totalAmount(notes) });
  }

  const total = lanes.reduce((sum, l) => sum + l.total, 0n);
  const noteCount = lanes.reduce((n, l) => n + l.notes.length, 0);
  const base = { lanes, total, identityBound: true };

  if (noteCount === 0) {
    return fail("no-notes", "The relationship is registered with the pool but holds no payments.", base);
  }

  if (total !== assertedTotal) {
    return fail(
      "total-mismatch",
      `The chain says ${total}, this disclosure claims ${assertedTotal}.`,
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
  return `The pool confirms payments between ${short(holder)} and ${short(
    counterparty,
  )}: ${parts.join(", ")}.`;
}

/**
 * What this disclosure exposes beyond the question that was asked.
 *
 * The Holder sees this before approving. It is deliberately blunt: a consent
 * screen that undersells the boundary is worse than no consent screen, because
 * it manufactures confidence rather than informing a decision.
 */
export function exposure(
  lanes: VerifiedLane[],
  asked?: { fromTime?: number; toTime?: number; noteCount?: number },
): string[] {
  const warnings: string[] = [];
  const total = lanes.reduce((n, l) => n + l.notes.length, 0);

  if (asked?.noteCount !== undefined && total > asked.noteCount) {
    warnings.push(
      `The requester asked about ${asked.noteCount} payment${
        asked.noteCount === 1 ? "" : "s"
      }, but this relationship contains ${total}. This mechanism works at relationship level, not payment level, so approving reveals all ${total}.`,
    );
  }

  const directions = lanes.filter((l) => l.notes.length > 0).map((l) => l.direction);
  if (directions.length === 2) {
    warnings.push(
      "Both directions are included: payments you received from this address and payments you sent to it.",
    );
  }

  warnings.push(
    "A channel key opens the whole relationship with this address for this asset. It cannot be narrowed to a single payment.",
  );

  return warnings;
}

function short(addr: Felt): string {
  const hex = "0x" + toFelt(addr).toString(16).padStart(64, "0");
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}
