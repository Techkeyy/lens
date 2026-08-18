/**
 * Pure derivation of STRK20 pool secrets and note locations.
 *
 * Every function here is a pure felt computation. No network, no wallet, no
 * state. This is the load-bearing module for Lens: a scoped disclosure is
 * exactly "here is a channel key, go recompute these note ids yourself".
 *
 * Formulas mirror the Cairo implementation in
 * starkware-libs/starknet-privacy, packages/privacy/src/hashes.cairo and
 * utils.cairo (Apache 2.0). derive.test.ts checks them against that repo's
 * own Cairo-generated reference vectors.
 */

import { ec, shortString } from "starknet";

/** Stark field prime. The pool encrypts by field addition, not by a cipher. */
export const FIELD_PRIME = ec.starkCurve.CURVE.Fp.ORDER;

/** Amounts are u128. Note salts occupy the 120 bits above them. */
export const TWO_POW_128 = 2n ** 128n;

/**
 * Domain separation tags. The `:V1` suffix is part of the tag: a mask derived
 * for one purpose can never be replayed in another context.
 */
export const TAG = {
  CHANNEL_KEY: "CHANNEL_KEY_TAG:V1",
  CHANNEL_MARKER: "CHANNEL_MARKER_TAG:V1",
  SUBCHANNEL_ID: "SUBCHANNEL_ID_TAG:V1",
  SUBCHANNEL_MARKER: "SUBCHANNEL_MARKER_TAG:V1",
  NOTE_ID: "NOTE_ID_TAG:V1",
  NULLIFIER: "NULLIFIER_TAG:V1",
  ENC_AMOUNT: "ENC_AMOUNT_TAG:V1",
  ENC_TOKEN: "ENC_TOKEN_TAG:V1",
  OUTGOING_CHANNEL_ID: "OUTGOING_CHANNEL_ID_TAG:V1",
} as const;

/** Anything address-shaped that has reached us as a string, number or bigint. */
export type Felt = string | number | bigint;

export function toFelt(v: Felt): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  const s = v.trim();
  if (s === "") throw new Error("toFelt: empty string");
  return BigInt(s);
}

/** Cairo short string literal, e.g. 'NOTE_ID_TAG:V1' as a felt. */
export function tagToFelt(tag: string): bigint {
  return BigInt(shortString.encodeShortString(tag));
}

/**
 * Poseidon hash with a leading domain tag, matching Cairo's
 * `hash([TAG, ...].span())`.
 */
export function hashWithTag(tag: string, ...values: Felt[]): bigint {
  return ec.starkCurve.poseidonHashMany([tagToFelt(tag), ...values.map(toFelt)]);
}

/**
 * The secret shared by one sender and one recipient, in one direction.
 *
 * This is the unit a Lens disclosure hands over. It is a Poseidon output, so
 * revealing it does not reveal the sender's private viewing key. It opens one
 * counterparty lane and nothing else.
 */
export function computeChannelKey(
  senderAddr: Felt,
  senderPrivateKey: Felt,
  recipientAddr: Felt,
  recipientPublicKey: Felt,
): bigint {
  return hashWithTag(
    TAG.CHANNEL_KEY,
    senderAddr,
    senderPrivateKey,
    recipientAddr,
    recipientPublicKey,
  );
}

export function computeChannelMarker(
  channelKey: Felt,
  senderAddr: Felt,
  recipientAddr: Felt,
  recipientPublicKey: Felt,
): bigint {
  return hashWithTag(
    TAG.CHANNEL_MARKER,
    channelKey,
    senderAddr,
    recipientAddr,
    recipientPublicKey,
  );
}

export function computeSubchannelId(channelKey: Felt, index: number): bigint {
  return hashWithTag(TAG.SUBCHANNEL_ID, channelKey, index, 0n);
}

export function computeSubchannelMarker(
  channelKey: Felt,
  recipientAddr: Felt,
  recipientPublicKey: Felt,
  token: Felt,
): bigint {
  return hashWithTag(
    TAG.SUBCHANNEL_MARKER,
    channelKey,
    recipientAddr,
    recipientPublicKey,
    token,
  );
}

/**
 * Where a note lives. Storage is WriteOnce, so this cell is immutable once
 * written, which is what makes a disclosure impossible to backdate.
 */
export function computeNoteId(channelKey: Felt, token: Felt, index: number): bigint {
  return hashWithTag(TAG.NOTE_ID, channelKey, token, index, 0n);
}

/**
 * Published when a note is spent. Binds the note to the owner's private
 * viewing key, so a verifier can check spent-or-not via the pool's public
 * `nullifier_exists` without holding anything.
 */
export function computeNullifier(
  channelKey: Felt,
  token: Felt,
  index: number,
  ownerPrivateKey: Felt,
): bigint {
  return hashWithTag(TAG.NULLIFIER, channelKey, token, index, 0n, ownerPrivateKey);
}

export function computeEncAmountHash(
  channelKey: Felt,
  token: Felt,
  index: number,
  salt: Felt,
): bigint {
  return hashWithTag(TAG.ENC_AMOUNT, channelKey, token, index, 0n, salt);
}

export function computeEncTokenHash(channelKey: Felt, index: number, salt: Felt): bigint {
  return hashWithTag(TAG.ENC_TOKEN, channelKey, index, 0n, salt);
}

/**
 * A note's stored payload, as returned by the pool's public `get_note`.
 * Packed as `salt * 2^128 + encAmount`, salt in the upper 120 bits.
 */
export function packNoteValue(salt: bigint, encAmount: bigint): bigint {
  return salt * TWO_POW_128 + encAmount;
}

export function encryptNoteAmount(
  channelKey: Felt,
  token: Felt,
  index: number,
  salt: bigint,
  amount: bigint,
): bigint {
  const pad = computeEncAmountHash(channelKey, token, index, salt);
  return packNoteValue(salt, (pad + amount) % TWO_POW_128);
}

/**
 * Recover a note's amount from its on-chain payload.
 *
 * The salt travels inside the packed value, so the channel key alone is enough:
 * a verifier needs nothing else from the discloser to read this lane.
 */
export function decryptNoteAmount(
  packedValue: Felt,
  channelKey: Felt,
  token: Felt,
  index: number,
): { amount: bigint; salt: bigint } {
  const packed = toFelt(packedValue);
  const salt = packed / TWO_POW_128;
  const encAmount = packed % TWO_POW_128;
  const pad = computeEncAmountHash(channelKey, token, index, salt) % TWO_POW_128;
  const amount = (encAmount + TWO_POW_128 - pad) % TWO_POW_128;
  return { amount, salt };
}

/** An empty WriteOnce cell reads as zero, which is how absence is detected. */
export function isEmptyNoteValue(packedValue: Felt): boolean {
  return toFelt(packedValue) === 0n;
}
