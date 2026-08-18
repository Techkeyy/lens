/**
 * The gate for the whole project.
 *
 * If these do not match, Lens cannot locate or read a note from a channel key,
 * and scoped disclosure is not buildable without a ZK circuit.
 *
 * Vectors are generated from the Cairo implementation itself
 * (starkware-libs/starknet-privacy, sdk/tests/fixtures/cairo-reference-data.json,
 * Apache 2.0). We assert our independent TypeScript against Cairo's own output,
 * not against ourselves.
 */

import { describe, expect, it } from "vitest";
import ref from "../../fixtures/cairo-reference-data.json";
import {
  TWO_POW_128,
  computeChannelKey,
  computeChannelMarker,
  computeEncAmountHash,
  computeEncTokenHash,
  computeNoteId,
  computeNullifier,
  computeSubchannelId,
  computeSubchannelMarker,
  decryptNoteAmount,
  encryptNoteAmount,
  isEmptyNoteValue,
} from "./derive";

const IN = ref.inputs;
const OUT = ref.outputs;

const hex = (v: bigint) => "0x" + v.toString(16);

describe("derive, against Cairo reference vectors", () => {
  it("channel key", () => {
    const got = computeChannelKey(
      IN.sender,
      IN.senderPrivateKey,
      IN.recipient,
      IN.recipientPublicKey,
    );
    expect(hex(got)).toBe(OUT.channelKey);
  });

  it("channel marker", () => {
    const got = computeChannelMarker(
      IN.channelKey,
      IN.sender,
      IN.recipient,
      IN.recipientPublicKey,
    );
    expect(hex(got)).toBe(OUT.channelMarker);
  });

  it("subchannel id", () => {
    expect(hex(computeSubchannelId(IN.channelKey, IN.index))).toBe(OUT.subchannelId);
  });

  it("subchannel marker", () => {
    const got = computeSubchannelMarker(
      IN.channelKey,
      IN.recipient,
      IN.recipientPublicKey,
      IN.token,
    );
    expect(hex(got)).toBe(OUT.subchannelMarker);
  });

  it("note id", () => {
    expect(hex(computeNoteId(IN.channelKey, IN.token, IN.index))).toBe(OUT.noteId);
  });

  it("nullifier", () => {
    const got = computeNullifier(IN.channelKey, IN.token, IN.index, IN.senderPrivateKey);
    expect(hex(got)).toBe(OUT.nullifier);
  });

  it("enc amount hash", () => {
    const got = computeEncAmountHash(IN.channelKey, IN.token, IN.index, IN.salt);
    expect(hex(got)).toBe(OUT.encAmountHash);
  });

  it("enc token hash", () => {
    expect(hex(computeEncTokenHash(IN.channelKey, IN.index, IN.salt))).toBe(OUT.encTokenHash);
  });
});

describe("note amount round trip", () => {
  it("recovers the amount the sender encrypted", () => {
    const amount = BigInt(IN.amount);
    const salt = BigInt(IN.salt);
    const packed = encryptNoteAmount(IN.channelKey, IN.token, IN.index, salt, amount);
    const got = decryptNoteAmount(packed, IN.channelKey, IN.token, IN.index);
    expect(got.amount).toBe(amount);
    expect(got.salt).toBe(salt);
  });

  it("packs salt above the amount, exactly as the pool stores it", () => {
    const salt = (1n << 119n) + 12345n;
    const packed = encryptNoteAmount(IN.channelKey, IN.token, IN.index, salt, 42n);
    expect(packed / TWO_POW_128).toBe(salt);
    expect(packed % TWO_POW_128 < TWO_POW_128).toBe(true);
  });

  it("gives the wrong answer under the wrong channel key, and does not throw", () => {
    const amount = 1000n;
    const salt = BigInt(IN.salt);
    const packed = encryptNoteAmount(IN.channelKey, IN.token, IN.index, salt, amount);
    const wrong = decryptNoteAmount(packed, "0xdeadbeef", IN.token, IN.index);
    expect(wrong.amount).not.toBe(amount);
    expect(wrong.salt).toBe(salt);
  });

  it("gives the wrong answer under the wrong index", () => {
    const salt = BigInt(IN.salt);
    const packed = encryptNoteAmount(IN.channelKey, IN.token, IN.index, salt, 1000n);
    expect(decryptNoteAmount(packed, IN.channelKey, IN.token, IN.index + 1).amount).not.toBe(
      1000n,
    );
  });

  it("treats an unwritten cell as empty", () => {
    expect(isEmptyNoteValue(0n)).toBe(true);
    expect(isEmptyNoteValue("0x0")).toBe(true);
    expect(isEmptyNoteValue(1n)).toBe(false);
  });
});

describe("live mainnet note shape", () => {
  // Read from the Sepolia pool v2.0 on 2026-08-18 via an anonymous
  // starknet_call to get_note. Kept as a fixture so the shape assertion runs
  // offline. See scripts/doctor.ts for the live version of this check.
  const REAL_PACKED = 0x9a150aa3369a34b9c0a1e053f2dbd95f705f8ef5df3eed6e7322828b1870c3n;

  it("splits a real note into a 120 bit salt and a 128 bit field", () => {
    const salt = REAL_PACKED / TWO_POW_128;
    const encAmount = REAL_PACKED % TWO_POW_128;
    expect(salt.toString(2).length).toBe(120);
    expect(encAmount < TWO_POW_128).toBe(true);
  });
});
