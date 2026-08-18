/**
 * Turning a disclosed channel key into a claim a stranger can check.
 *
 * The subtle part is identity. A channel key on its own proves only that notes
 * exist at some storage locations; it says nothing about who paid whom, since
 * `channel_key = h(TAG, sender, sender_private_key, recipient, recipient_pub)`
 * cannot be inverted and the verifier does not hold the sender's key.
 *
 * The pool closes that gap for us. `channel_exists(channel_marker)` is a public
 * view, and the marker is computed from the channel key plus both addresses and
 * the recipient's registered public key, all of which the verifier can obtain
 * or is being asked to check. If the pool says that marker exists, the pool is
 * attesting that this channel key belongs to that exact pair, in that
 * direction. That is what makes a Lens claim sound without a circuit.
 */

import {
  type Felt,
  computeChannelMarker,
  computeSubchannelMarker,
  toFelt,
} from "./derive";
import { type NoteReader, type ReadNote, scanSubchannel, totalAmount } from "./read";

/** One counterparty lane, in one direction, for one token. */
export type ChannelScope = {
  /** Who sent, in the direction being disclosed. */
  sender: string;
  /** Who received. Their registered public key is read from the pool. */
  recipient: string;
  token: string;
};

export type RelationshipClaim = {
  kind: "relationship";
  scope: ChannelScope;
  /** What the discloser asserts the lane totals. */
  assertedTotal: bigint;
  /** Optional per-note assertion, checked when present. */
  assertedAmounts?: bigint[];
};

export type ClaimFailure =
  | "unregistered-recipient"
  | "channel-not-in-pool"
  | "subchannel-not-in-pool"
  | "no-notes"
  | "total-mismatch"
  | "amounts-mismatch";

export type ClaimResult = {
  verified: boolean;
  failure?: ClaimFailure;
  /** Human-readable reason, safe to show a verifier who is not a developer. */
  reason: string;
  notes: ReadNote[];
  total: bigint;
  /** True once the pool has confirmed the key belongs to this pair. */
  identityBound: boolean;
};

function fail(failure: ClaimFailure, reason: string, extra: Partial<ClaimResult> = {}): ClaimResult {
  return {
    verified: false,
    failure,
    reason,
    notes: [],
    total: 0n,
    identityBound: false,
    ...extra,
  };
}

/**
 * Check a relationship claim against the pool.
 *
 * Everything here is a public read. The only secret involved is the channel key
 * the discloser chose to hand over, and it opens one lane.
 */
export async function verifyRelationship(
  reader: NoteReader,
  channelKey: Felt,
  claim: RelationshipClaim,
): Promise<ClaimResult> {
  const { sender, recipient, token } = claim.scope;

  // The recipient must have registered a viewing key, or no channel to them
  // could exist in the first place.
  const recipientPublicKey = await reader.getPublicKey(recipient);
  if (recipientPublicKey === 0n) {
    return fail(
      "unregistered-recipient",
      `${short(recipient)} has never registered with the pool, so no channel to them can exist.`,
    );
  }

  // Bind the disclosed key to the named pair. Without this the rest proves
  // only that some notes exist somewhere.
  const marker = computeChannelMarker(channelKey, sender, recipient, recipientPublicKey);
  if (!(await reader.channelExists(marker))) {
    return fail(
      "channel-not-in-pool",
      `The pool has no channel from ${short(sender)} to ${short(recipient)} matching this key.`,
    );
  }

  const subMarker = computeSubchannelMarker(channelKey, recipient, recipientPublicKey, token);
  if (!(await reader.subchannelExists(subMarker))) {
    return fail(
      "subchannel-not-in-pool",
      `That channel exists, but it holds nothing in token ${short(token)}.`,
      { identityBound: true },
    );
  }

  const notes = await scanSubchannel(reader, channelKey, token);
  if (notes.length === 0) {
    return fail("no-notes", "The lane is registered but holds no notes.", {
      identityBound: true,
    });
  }

  const total = totalAmount(notes);
  const base = { notes, total, identityBound: true };

  if (total !== claim.assertedTotal) {
    return fail(
      "total-mismatch",
      `The chain says ${total}, the disclosure claims ${claim.assertedTotal}.`,
      base,
    );
  }

  if (claim.assertedAmounts) {
    const chain = notes.map((n) => n.amount);
    const same =
      chain.length === claim.assertedAmounts.length &&
      chain.every((a, i) => a === claim.assertedAmounts![i]);
    if (!same) {
      return fail(
        "amounts-mismatch",
        `The individual amounts do not match: chain has [${chain.join(", ")}].`,
        base,
      );
    }
  }

  return {
    verified: true,
    reason: `The pool confirms ${notes.length} payment${
      notes.length === 1 ? "" : "s"
    } from ${short(sender)} to ${short(recipient)} totalling ${total}.`,
    ...base,
  };
}

/** What this disclosure exposes beyond the question that was asked. */
export function overreach(
  notes: ReadNote[],
  asked: { minAmount?: bigint; maxNotes?: number } = {},
): string[] {
  const warnings: string[] = [];
  if (asked.maxNotes !== undefined && notes.length > asked.maxNotes) {
    warnings.push(
      `The key opens ${notes.length} payments, but only ${asked.maxNotes} were asked about. The rest are revealed too.`,
    );
  }
  if (notes.length > 0) {
    warnings.push(
      "A channel key opens the whole lane with this counterparty, in this direction, for this token. It cannot be narrowed to a single payment.",
    );
  }
  return warnings;
}

function short(addr: Felt): string {
  const hex = "0x" + toFelt(addr).toString(16).padStart(64, "0");
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}
