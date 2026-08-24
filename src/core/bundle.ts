/**
 * The request and the disclosure, and the digest that ties them to the chain.
 *
 * A request says what is being asked for. A bundle answers it, and carries the
 * channel keys that let the asker check the answer themselves. Neither ever
 * goes on chain: only the bundle's digest is anchored, which buys a timestamp,
 * an issuer, and revocation without publishing anything about the payments or
 * about who asked.
 *
 * Both sides must compute byte-identical digests, so serialisation here is
 * canonical: fixed field order, felts normalised, no optional whitespace, no
 * dependence on JSON key ordering.
 */

import { ec, hash } from "starknet";
import { type Felt, toFelt } from "./derive";

export const BUNDLE_VERSION = 1;

const REQUEST_TAG = "LENS_REQUEST:V1";
const BUNDLE_TAG = "LENS_BUNDLE:V1";

/** One counterparty lane, one direction, one token. */
export type Scope = {
  /** Who sent, in the direction being proven. */
  sender: string;
  /** Who received. */
  recipient: string;
  token: string;
};

/** What a verifier is asking to be shown. Built without a wallet. */
export type Request = {
  v: number;
  chainId: string;
  pool: string;
  /** Free text naming who is asking. Shown to the discloser, never on chain. */
  requester: string;
  /** Why, in the requester's own words. Shown before anything is revealed. */
  purpose: string;
  scope: Scope;
  /** Unix seconds. Zero means the request never goes stale. */
  expiresAt: number;
  /** Makes two otherwise identical requests distinguishable. */
  nonce: string;
};

/** The answer, handed to exactly one person, out of band. */
export type Bundle = {
  v: number;
  chainId: string;
  pool: string;
  /** Digest of the request this answers, or "0x0" when sent unprompted. */
  requestDigest: string;
  /** The address claiming to have been paid. Must match the anchor's issuer. */
  subject: string;
  scope: Scope;
  /** The key that opens the lane. This is the disclosure. */
  channelKey: string;
  /** What the discloser asserts, checked against the chain by the verifier. */
  assertedTotal: string;
  assertedAmounts?: string[];
  issuedAt: number;
  expiresAt: number;
};

const felt = (v: Felt) => "0x" + toFelt(v).toString(16);

/** Short strings are felts; longer text is hashed so any length is accepted. */
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

/**
 * Commits to everything a verifier relies on. Changing any of it, including
 * the scope or the expiry, produces a different digest and therefore fails
 * against the anchor.
 */
export function requestDigest(r: Request): string {
  return poseidon([
    textToFelt(REQUEST_TAG),
    BigInt(r.v),
    toFelt(r.chainId),
    toFelt(r.pool),
    textToFelt(r.requester),
    textToFelt(r.purpose),
    toFelt(r.scope.sender),
    toFelt(r.scope.recipient),
    toFelt(r.scope.token),
    BigInt(r.expiresAt),
    textToFelt(r.nonce),
  ]);
}

/**
 * The value anchored on chain.
 *
 * It commits to the channel key, so an anchor cannot be reused to vouch for a
 * different lane. The key itself stays secret: this is a hash, and the chain
 * only ever sees the hash.
 */
export function bundleDigest(b: Bundle): string {
  const amounts = b.assertedAmounts ?? [];
  return poseidon([
    textToFelt(BUNDLE_TAG),
    BigInt(b.v),
    toFelt(b.chainId),
    toFelt(b.pool),
    toFelt(b.requestDigest),
    toFelt(b.subject),
    toFelt(b.scope.sender),
    toFelt(b.scope.recipient),
    toFelt(b.scope.token),
    toFelt(b.channelKey),
    toFelt(b.assertedTotal),
    BigInt(amounts.length),
    ...amounts.map((a) => toFelt(a)),
    BigInt(b.issuedAt),
    BigInt(b.expiresAt),
  ]);
}

export function makeRequest(
  input: Omit<Request, "v" | "nonce"> & { nonce?: string },
): Request {
  return {
    v: BUNDLE_VERSION,
    ...input,
    nonce: input.nonce ?? randomNonce(),
  };
}

export function randomNonce(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Normalise felts so two clients that formatted differently still agree. */
export function normalizeBundle(b: Bundle): Bundle {
  return {
    ...b,
    chainId: felt(b.chainId),
    pool: felt(b.pool),
    requestDigest: felt(b.requestDigest),
    subject: felt(b.subject),
    scope: {
      sender: felt(b.scope.sender),
      recipient: felt(b.scope.recipient),
      token: felt(b.scope.token),
    },
    channelKey: felt(b.channelKey),
    assertedTotal: toFelt(b.assertedTotal).toString(),
    assertedAmounts: b.assertedAmounts?.map((a) => toFelt(a).toString()),
  };
}

/** Does this bundle actually answer that request, or a different question? */
export function answersRequest(b: Bundle, r: Request): { ok: boolean; reason: string } {
  if (b.requestDigest !== requestDigest(r)) {
    return { ok: false, reason: "This disclosure was made for a different request." };
  }
  const same = (x: string, y: string) => toFelt(x) === toFelt(y);
  if (
    !same(b.scope.sender, r.scope.sender) ||
    !same(b.scope.recipient, r.scope.recipient) ||
    !same(b.scope.token, r.scope.token)
  ) {
    return { ok: false, reason: "The disclosure covers a different lane than the one requested." };
  }
  if (!same(b.chainId, r.chainId) || !same(b.pool, r.pool)) {
    return { ok: false, reason: "The disclosure is for a different network or pool." };
  }
  return { ok: true, reason: "This disclosure answers the request it was made for." };
}

export function isExpired(expiresAt: number, now = Math.floor(Date.now() / 1000)): boolean {
  return expiresAt !== 0 && now > expiresAt;
}

// A link has to survive email clients, chat apps, and being pasted by hand, so
// base64url with no padding rather than raw JSON in a query string.

export function encodeLink(value: Request | Bundle): string {
  const json = JSON.stringify(value);
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeLink<T extends Request | Bundle>(encoded: string): T {
  const json = Buffer.from(encoded, "base64url").toString("utf8");
  const parsed = JSON.parse(json) as T;
  if (parsed.v !== BUNDLE_VERSION) {
    throw new Error(
      `This link was made by Lens version ${parsed.v}, and this page reads version ${BUNDLE_VERSION}.`,
    );
  }
  return parsed;
}
