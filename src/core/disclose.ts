/**
 * The one path that creates a disclosure.
 *
 * Interfaces must never assemble cryptographic structures themselves. A screen
 * that builds its own commitment will eventually build a subtly different one,
 * and the failure surfaces as "verification refused" with no explanation. So
 * everything goes through `createDisclosure`.
 *
 * What it does, in order: resolve which lanes actually exist, read each lane,
 * freeze the boundary at today's note count, total it, and commit to all of it.
 * The Holder's viewing key is used to find and read; it is never placed in the
 * result.
 */

import { type ChannelSource, resolveRelationship } from "./channels";
import { type NoteReader, countNotes, scanRange, totalAmount } from "./read";
import { type Direction, type LaneKeys, WARNINGS, exposure } from "./claim";
import {
  DISCLOSURE_SCHEME,
  type Disclosure,
  type LaneSnapshot,
  type Request,
  type Snapshot,
  canonicalDirections,
  disclosureCommitment,
  requestCommitment,
} from "./bundle";
import type { Session } from "./session";

export type DisclosurePreview = {
  disclosure: Disclosure;
  commitment: string;
  /** Per lane, what the Holder is about to reveal. */
  lanes: { direction: Direction; noteCount: number; total: bigint }[];
  /** Plain sentences for the consent screen. Do not reword these downstream. */
  warnings: string[];
  /** Nothing to disclose. The caller should say so rather than sign anything. */
  empty: boolean;
};

export class DisclosureError extends Error {}

/**
 * Build the disclosure a Holder is about to authorize.
 *
 * `reader` must serve both note reads and channel discovery, which the pool
 * reader does. `now` is injected so tests are deterministic.
 */
export async function createDisclosure(
  reader: NoteReader & ChannelSource,
  session: Session,
  request: Request,
  opts: { now?: number; maxNotesPerLane?: number } = {},
): Promise<DisclosurePreview> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const maxNotes = opts.maxNotesPerLane ?? 256;

  if (BigInt(request.chainId) !== BigInt(session.chainId)) {
    throw new DisclosureError(
      "This request is for a different network than the wallet is connected to.",
    );
  }
  if (BigInt(request.pool) !== BigInt(session.pool)) {
    throw new DisclosureError("This request names a different privacy pool.");
  }
  if (BigInt(request.counterparty) === BigInt(session.address)) {
    throw new DisclosureError("A disclosure about yourself would prove nothing.");
  }

  const relationship = await resolveRelationship(
    reader,
    session.address,
    session.viewingKey,
    request.counterparty,
  );

  const keys: LaneKeys = {};
  if (relationship.outboundKey !== undefined) {
    keys.outbound = "0x" + relationship.outboundKey.toString(16);
  }
  if (relationship.inboundKey !== undefined) {
    keys.inbound = "0x" + relationship.inboundKey.toString(16);
  }

  const candidates = canonicalDirections(
    (["outbound", "inbound"] as const).filter((d) => keys[d] !== undefined),
  );

  const snapshot: Snapshot = {};
  const lanes: DisclosurePreview["lanes"] = [];
  const directions: Direction[] = [];
  let assertedTotal = 0n;

  for (const direction of candidates) {
    const channelKey = keys[direction]!;

    // The boundary is fixed here, at approval time, from the live lane.
    const noteCount = await countNotes(reader, channelKey, request.token, maxNotes);
    const { notes, missingIndex } = await scanRange(
      reader,
      channelKey,
      request.token,
      noteCount,
    );
    if (missingIndex !== undefined) {
      // Indices are dense, so this should be unreachable. If it ever happens,
      // refuse rather than authorize a boundary we cannot stand behind.
      throw new DisclosureError(
        `Could not read the ${direction} payments completely, so nothing was authorized.`,
      );
    }

    // An empty lane is left out entirely. Its key is reusable, so including it
    // would hand over the ability to read future payments in a direction where
    // nothing has happened, which discloses more than the holder is proving.
    if (noteCount === 0) {
      delete keys[direction];
      continue;
    }

    const total = totalAmount(notes);
    const lane: LaneSnapshot = { noteCount, total: total.toString() };
    snapshot[direction] = lane;
    directions.push(direction);
    lanes.push({ direction, noteCount, total });
    assertedTotal += total;
  }

  const disclosure: Disclosure = {
    scheme: DISCLOSURE_SCHEME,
    chainId: session.chainId,
    pool: session.pool,
    requestCommitment: requestCommitment(request),
    scope: {
      holder: session.address,
      counterparty: request.counterparty,
      token: request.token,
    },
    directions,
    keys,
    snapshot,
    assertedTotal: assertedTotal.toString(),
    createdAt: now,
  };

  const empty = lanes.length === 0;
  const warnings = empty
    ? [`No payments were found between you and this address in this asset.`]
    : [...exposure(lanes.map(({ direction, noteCount }) => ({ direction, noteCount }))),
       WARNINGS.noProvenDates];

  return {
    disclosure,
    commitment: disclosureCommitment(disclosure),
    lanes,
    warnings,
    empty,
  };
}

/**
 * Build a disclosure with no request behind it, for "here is your receipt".
 *
 * The same path, with a zero request commitment.
 */
export async function createUnpromptedDisclosure(
  reader: NoteReader & ChannelSource,
  session: Session,
  counterparty: string,
  token: string,
  opts: { now?: number; maxNotesPerLane?: number } = {},
): Promise<DisclosurePreview> {
  const preview = await createDisclosure(
    reader,
    session,
    {
      scheme: "lens-request-v1",
      chainId: session.chainId,
      pool: session.pool,
      requester: "",
      purpose: "",
      counterparty,
      token,
      nonce: "",
    },
    opts,
  );
  const disclosure = { ...preview.disclosure, requestCommitment: "0x0" };
  return {
    ...preview,
    disclosure,
    commitment: disclosureCommitment(disclosure),
  };
}
