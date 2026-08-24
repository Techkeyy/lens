/**
 * The request, the disclosure, and the commitment that ties it to the chain.
 *
 * A request says what a Verifier wants to see. A disclosure answers it and
 * carries the channel keys that let the Verifier check the answer themselves.
 * Neither goes on chain. Only the commitment does, which buys authorization, a
 * timestamp and integrity without publishing the payments or who asked.
 *
 * # Why v2 exists
 *
 * v1 committed to a channel key and a total, and verification walked the lane
 * until it ran out of notes. That was wrong in two directions at once. A
 * payment arriving after authorization silently joined the "authorized" set,
 * and it also changed the total, so the Holder's own disclosure stopped
 * verifying through no fault of theirs.
 *
 * v2 commits to a **snapshot boundary**: how many notes each lane held at
 * authorization time, and what they totalled. Notes live in WriteOnce cells at
 * dense sequential indices, so indices 0..count-1 name the same notes forever.
 * Later payments land at higher indices, outside the authorized range.
 *
 * This does not make Lens payment-selective. The unit is still the whole
 * relationship as it stood at one moment.
 */

import { ec } from "starknet";
import { type Felt, toFelt } from "./derive";
import type { Direction, LaneKeys } from "./claim";

/** Retired. Kept only so a v1 link is rejected loudly rather than misread. */
export const DISCLOSURE_SCHEME_V1 = "lens-disclosure-v1";

export const DISCLOSURE_SCHEME = "lens-disclosure-v2";
export const REQUEST_SCHEME = "lens-request-v1";

const DISCLOSURE_TAG = "LENS_DISCLOSURE:V2";
const REQUEST_TAG = "LENS_REQUEST:V1";

/** One relationship, one asset. */
export type Scope = {
  /** Whose history is being disclosed. */
  holder: string;
  /** The address the relationship is with. */
  counterparty: string;
  token: string;
};

/** What a Verifier is asking to see. Built with no wallet and no account. */
export type Request = {
  scheme: typeof REQUEST_SCHEME;
  chainId: string;
  pool: string;
  /** Who is asking, in their own words. Shown to the Holder, never on chain. */
  requester: string;
  /** Why. Free text context, not a cryptographic constraint. */
  purpose: string;
  counterparty: string;
  token: string;
  nonce: string;
};

/**
 * The frozen boundary for one lane.
 *
 * `noteCount` is the number of notes the lane held when the Holder approved.
 * Verification reads exactly indices 0..noteCount-1 and nothing else.
 */
export type LaneSnapshot = {
  noteCount: number;
  total: string;
};

export type Snapshot = {
  outbound?: LaneSnapshot;
  inbound?: LaneSnapshot;
};

/** The answer, handed to a Verifier out of band. */
export type Disclosure = {
  scheme: typeof DISCLOSURE_SCHEME;
  chainId: string;
  pool: string;
  /** Commitment of the request this answers, or "0x0" when sent unprompted. */
  requestCommitment: string;
  scope: Scope;
  /** Which lanes are included, in canonical order. */
  directions: Direction[];
  /** The keys themselves. Reusable, and therefore the secret part. */
  keys: LaneKeys;
  /** The frozen boundary and total per lane. */
  snapshot: Snapshot;
  /** Sum across every included lane at authorization time. */
  assertedTotal: string;
  createdAt: number;
};

const felt = (v: Felt) => "0x" + toFelt(v).toString(16);

/** Short text is a felt; longer text is folded so any length is accepted. */
function textToFelt(text: string): bigint {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= 31) {
    let acc = 0n;
    for (const b of bytes) acc = (acc << 8n) | BigInt(b);
    return acc;
  }
  let acc = 0n;
  for (const b of bytes) acc = (acc * 257n + BigInt(b)) % ec.starkCurve.CURVE.p;
  return acc;
}

function poseidon(values: bigint[]): string {
  return "0x" + ec.starkCurve.poseidonHashMany(values).toString(16);
}

/** Fixed order so both lanes serialise identically everywhere. */
const DIRECTION_ORDER: Direction[] = ["outbound", "inbound"];
const directionCode = (d: Direction) => (d === "outbound" ? 1n : 2n);

export function canonicalDirections(directions: Direction[]): Direction[] {
  return DIRECTION_ORDER.filter((d) => directions.includes(d));
}

export function requestCommitment(r: Request): string {
  return poseidon([
    textToFelt(REQUEST_TAG),
    textToFelt(r.scheme),
    toFelt(r.chainId),
    toFelt(r.pool),
    textToFelt(r.requester),
    textToFelt(r.purpose),
    toFelt(r.counterparty),
    toFelt(r.token),
    textToFelt(r.nonce),
  ]);
}

/**
 * The value anchored on chain.
 *
 * It binds the channel keys **and the snapshot boundary**, so an authorization
 * cannot be re-pointed at a different relationship, and cannot be stretched to
 * cover payments that arrived later. The keys stay secret: the chain only ever
 * sees this hash.
 */
export function disclosureCommitment(d: Disclosure): string {
  const directions = canonicalDirections(d.directions);
  return poseidon([
    textToFelt(DISCLOSURE_TAG),
    textToFelt(d.scheme),
    toFelt(d.chainId),
    toFelt(d.pool),
    toFelt(d.requestCommitment),
    toFelt(d.scope.holder),
    toFelt(d.scope.counterparty),
    toFelt(d.scope.token),
    BigInt(directions.length),
    ...directions.map(directionCode),
    ...directions.map((dir) => toFelt(d.keys[dir] ?? 0)),
    ...directions.map((dir) => BigInt(d.snapshot[dir]?.noteCount ?? 0)),
    ...directions.map((dir) => toFelt(d.snapshot[dir]?.total ?? 0)),
    toFelt(d.assertedTotal),
    BigInt(d.createdAt),
  ]);
}

export function makeRequest(
  input: Omit<Request, "scheme" | "nonce"> & { nonce?: string },
): Request {
  return { scheme: REQUEST_SCHEME, ...input, nonce: input.nonce ?? randomNonce() };
}

export function randomNonce(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Normalise felts so two clients that formatted differently still agree. */
export function normalizeDisclosure(d: Disclosure): Disclosure {
  const keys: LaneKeys = {};
  if (d.keys.outbound) keys.outbound = felt(d.keys.outbound);
  if (d.keys.inbound) keys.inbound = felt(d.keys.inbound);
  const snapshot: Snapshot = {};
  for (const dir of canonicalDirections(d.directions)) {
    const lane = d.snapshot[dir];
    if (lane) snapshot[dir] = { noteCount: lane.noteCount, total: toFelt(lane.total).toString() };
  }
  return {
    ...d,
    chainId: felt(d.chainId),
    pool: felt(d.pool),
    requestCommitment: felt(d.requestCommitment),
    scope: {
      holder: felt(d.scope.holder),
      counterparty: felt(d.scope.counterparty),
      token: felt(d.scope.token),
    },
    directions: canonicalDirections(d.directions),
    keys,
    snapshot,
    assertedTotal: toFelt(d.assertedTotal).toString(),
  };
}

/** Does this disclosure answer that request, or a cheaper question? */
export function answersRequest(d: Disclosure, r: Request): { ok: boolean; reason: string } {
  const same = (x: Felt, y: Felt) => toFelt(x) === toFelt(y);
  if (d.requestCommitment !== requestCommitment(r)) {
    return { ok: false, reason: "This disclosure was made for a different request." };
  }
  if (!same(d.scope.counterparty, r.counterparty) || !same(d.scope.token, r.token)) {
    return {
      ok: false,
      reason: "The disclosure covers a different relationship than the one requested.",
    };
  }
  if (!same(d.chainId, r.chainId) || !same(d.pool, r.pool)) {
    return { ok: false, reason: "The disclosure is for a different network or pool." };
  }
  return { ok: true, reason: "This disclosure answers the request it was made for." };
}

// Encoding. A request link carries nothing sensitive. A disclosure carries
// reusable channel keys, so see transport.ts for how it is actually shared.

export function encodeLink(value: Request | Disclosure): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeRequest(encoded: string): Request {
  const parsed = decode<Request>(encoded);
  if (parsed.scheme !== REQUEST_SCHEME) throw unknownScheme(parsed.scheme, REQUEST_SCHEME);
  return parsed;
}

export function decodeDisclosure(encoded: string): Disclosure {
  const parsed = decode<Disclosure>(encoded);
  if (parsed.scheme !== DISCLOSURE_SCHEME) {
    throw unknownScheme(parsed.scheme, DISCLOSURE_SCHEME);
  }
  if (!parsed.snapshot || typeof parsed.snapshot !== "object") {
    throw new Error("This disclosure has no snapshot boundary and cannot be verified.");
  }
  return parsed;
}

function decode<T>(encoded: string): T {
  let json: string;
  try {
    json = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    throw new Error("This link is damaged and could not be read.");
  }
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error("This link is damaged and could not be read.");
  }
}

/** Refuse an unknown format rather than guessing at its meaning. */
function unknownScheme(found: unknown, expected: string): Error {
  return new Error(
    `This link uses format "${String(found)}", and this page understands "${expected}". Verification is refused rather than guessed.`,
  );
}
