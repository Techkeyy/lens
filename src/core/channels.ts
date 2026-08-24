/**
 * Channel discovery, in both directions.
 *
 * A relationship between a Holder and a Counterparty is not one thing. It is
 * two independent one-way lanes with two unrelated keys:
 *
 *   outbound  Holder -> Counterparty   the Holder derives it from their own
 *                                      viewing key and the Counterparty's
 *                                      registered public key
 *   inbound   Counterparty -> Holder   the Counterparty derived it. The Holder
 *                                      can only recover it by decrypting the
 *                                      channel record the Counterparty
 *                                      published, using ECDH
 *
 * A product that says "payments between you and this address" has to inspect
 * both, or the sentence is false. The outbound lane is cheap. The inbound lane
 * is the one that needs this file.
 */

import { ec } from "starknet";
import {
  FIELD_PRIME,
  type Felt,
  computeChannelKey,
  hashWithTag,
  toFelt,
} from "./derive";

const ENC_CHANNEL_KEY_TAG = "ENC_CHANNEL_KEY_TAG:V1";
const ENC_SENDER_ADDR_TAG = "ENC_SENDER_ADDR_TAG:V1";

/** As published by the sender when they opened the lane. */
export type EncChannelInfo = {
  ephemeralPubkey: bigint;
  encChannelKey: bigint;
  encSenderAddr: bigint;
};

export type InboundChannel = {
  /** Index in the recipient's channel list. */
  index: number;
  /** Who opened it. Decrypted, not asserted. */
  sender: bigint;
  channelKey: bigint;
};

/**
 * Rebuild a curve point from its x-coordinate.
 *
 * The pool stores only x, so y is recovered from y^2 = x^3 + ax + b. Both roots
 * give the same ECDH shared x, which is the only part used.
 */
function pointFromX(x: bigint): Uint8Array {
  const Fp = ec.starkCurve.CURVE.Fp;
  const { a, b } = ec.starkCurve.CURVE;
  const y2 = Fp.add(Fp.add(Fp.mul(Fp.mul(x, x), x), Fp.mul(a, x)), b);
  const y = Fp.sqrt(y2);
  if (y === undefined) throw new Error("ephemeral public key is not on the curve");
  return ec.starkCurve.ProjectivePoint.fromAffine({ x, y }).toRawBytes(true);
}

function toBytes(v: bigint): Uint8Array {
  const hex = v.toString(16).padStart(64, "0");
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

function xOf(point: Uint8Array): bigint {
  const start = point.length === 33 || point.length === 65 ? 1 : 0;
  return BigInt(
    "0x" +
      Array.from(point.slice(start, start + 32))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
  );
}

/** Field subtraction, kept positive. The pool encrypts by adding a mask. */
function unmask(masked: bigint, mask: bigint): bigint {
  return (((masked - mask) % FIELD_PRIME) + FIELD_PRIME) % FIELD_PRIME;
}

/**
 * Recover an inbound lane's key from the record its sender published.
 *
 * Only the Holder can do this, because it needs their private viewing key. The
 * result is the same secret the sender used, which is what makes a disclosure
 * of an inbound lane possible at all.
 */
export function decryptChannelInfo(
  info: EncChannelInfo,
  holderViewingKey: Felt,
): { channelKey: bigint; sender: bigint } {
  const shared = ec.starkCurve.getSharedSecret(
    toBytes(toFelt(holderViewingKey)),
    pointFromX(info.ephemeralPubkey),
  );
  const sharedX = xOf(shared);
  return {
    channelKey: unmask(info.encChannelKey, hashWithTag(ENC_CHANNEL_KEY_TAG, sharedX)),
    sender: unmask(info.encSenderAddr, hashWithTag(ENC_SENDER_ADDR_TAG, sharedX)),
  };
}

/** What the two lanes of one relationship look like once resolved. */
export type Relationship = {
  holder: string;
  counterparty: string;
  /** Present when the Holder has ever paid the Counterparty. */
  outboundKey?: bigint;
  /** Present when the Counterparty has ever paid the Holder. */
  inboundKey?: bigint;
};

export type ChannelSource = {
  getNumOfChannels(recipient: Felt): Promise<number>;
  getChannelInfo(recipient: Felt, index: number): Promise<EncChannelInfo>;
  getPublicKey(addr: Felt): Promise<bigint>;
  channelExists(marker: Felt): Promise<boolean>;
};

/**
 * Walk the Holder's inbound channels and decrypt each until the Counterparty
 * is found.
 *
 * Cost is proportional to the Holder's own activity, not to the pool's, because
 * only lanes addressed to them appear in their list.
 */
export async function findInboundChannel(
  source: ChannelSource,
  holder: string,
  counterparty: string,
  holderViewingKey: Felt,
): Promise<InboundChannel | undefined> {
  const count = await source.getNumOfChannels(holder);
  const wanted = toFelt(counterparty);
  for (let index = 0; index < count; index++) {
    const info = await source.getChannelInfo(holder, index);
    let decrypted;
    try {
      decrypted = decryptChannelInfo(info, holderViewingKey);
    } catch {
      // A record we cannot open is not ours to read. Skip rather than abort,
      // so one malformed entry cannot hide every later lane.
      continue;
    }
    if (decrypted.sender === wanted) {
      return { index, sender: decrypted.sender, channelKey: decrypted.channelKey };
    }
  }
  return undefined;
}

/**
 * Resolve both lanes of one relationship.
 *
 * The outbound key is derived. The inbound key is discovered and decrypted.
 * Either may be absent: a relationship where money only ever flowed one way is
 * normal, not an error.
 */
export async function resolveRelationship(
  source: ChannelSource,
  holder: string,
  holderViewingKey: Felt,
  counterparty: string,
): Promise<Relationship> {
  const relationship: Relationship = { holder, counterparty };

  const counterpartyPublicKey = await source.getPublicKey(counterparty);
  if (counterpartyPublicKey !== 0n) {
    const candidate = computeChannelKey(
      holder,
      holderViewingKey,
      counterparty,
      counterpartyPublicKey,
    );
    // Derivation always produces a key. Only the pool can say whether that lane
    // was ever opened, so ask it before claiming the lane exists.
    const marker = hashWithTag(
      "CHANNEL_MARKER_TAG:V1",
      candidate,
      holder,
      counterparty,
      counterpartyPublicKey,
    );
    if (await source.channelExists(marker)) relationship.outboundKey = candidate;
  }

  const inbound = await findInboundChannel(source, holder, counterparty, holderViewingKey);
  if (inbound) relationship.inboundKey = inbound.channelKey;

  return relationship;
}

export function hasAnyLane(r: Relationship): boolean {
  return r.outboundKey !== undefined || r.inboundKey !== undefined;
}

/**
 * The sender's side of the same operation.
 *
 * Lens does not open lanes, so this exists to prove the decryption above is
 * correct by round tripping it. Keeping it here rather than in the test file
 * means the two halves cannot drift apart.
 */
export function encryptChannelInfo(
  ephemeralSecret: bigint,
  recipientPublicKey: bigint,
  channelKey: bigint,
  senderAddr: bigint,
): EncChannelInfo {
  const ephemeralPubkey = xOf(ec.starkCurve.getPublicKey(toBytes(ephemeralSecret)));
  const shared = ec.starkCurve.getSharedSecret(
    toBytes(ephemeralSecret),
    pointFromX(recipientPublicKey),
  );
  const sharedX = xOf(shared);
  const mask = (tag: string) => hashWithTag(tag, sharedX);
  return {
    ephemeralPubkey,
    encChannelKey: (mask(ENC_CHANNEL_KEY_TAG) + channelKey) % FIELD_PRIME,
    encSenderAddr: (mask(ENC_SENDER_ADDR_TAG) + senderAddr) % FIELD_PRIME,
  };
}
