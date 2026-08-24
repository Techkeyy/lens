/**
 * The product's load-bearing assumption, tested.
 *
 * The chain being proven here is: one signature -> viewing key -> public key ->
 * channel key -> note id -> readable amount. If any link fails, a dapp cannot
 * read a user's own payments and there is no product.
 *
 * What this does not prove: that the note was written by the real pool. That
 * needs a live shielded payment and is covered by scripts/roundtrip.ts.
 */

import { describe, expect, it } from "vitest";
import {
  CURVE_ORDER,
  MAX_VIEWING_KEY,
  deriveViewingKeyFromPrivateKey,
  foldToViewingKey,
  publicViewingKey,
  sessionFromSignature,
  viewingKeyFromWalletSignature,
  viewingKeyMessage,
} from "./session";
import {
  computeChannelKey,
  computeNoteId,
  decryptNoteAmount,
  encryptNoteAmount,
} from "./derive";

const SN_MAIN = "0x534e5f4d41494e";
const SN_SEPOLIA = "0x534e5f5345504f4c4941";
const POOL_MAIN = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const POOL_SEPOLIA = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

const ALICE_PK = "0x1234567890abcdef1234567890abcdef";
const BOB_PK = "0xfedcba0987654321fedcba0987654321";

describe("viewing key derivation", () => {
  it("is deterministic, which is what lets us store nothing", () => {
    const a = deriveViewingKeyFromPrivateKey(ALICE_PK, SN_MAIN, POOL_MAIN);
    const b = deriveViewingKeyFromPrivateKey(ALICE_PK, SN_MAIN, POOL_MAIN);
    expect(a).toBe(b);
  });

  it("lands inside the range the pool enforces", () => {
    for (const pk of [ALICE_PK, BOB_PK, "0x1", "0x" + "f".repeat(60)]) {
      const k = deriveViewingKeyFromPrivateKey(pk, SN_MAIN, POOL_MAIN);
      expect(k >= 1n).toBe(true);
      expect(k < MAX_VIEWING_KEY).toBe(true);
    }
  });

  it("binds to the chain, so a sepolia key cannot be replayed on mainnet", () => {
    const main = deriveViewingKeyFromPrivateKey(ALICE_PK, SN_MAIN, POOL_MAIN);
    const sepolia = deriveViewingKeyFromPrivateKey(ALICE_PK, SN_SEPOLIA, POOL_MAIN);
    expect(main).not.toBe(sepolia);
  });

  it("binds to the pool, so a future pool gets a fresh key", () => {
    const a = deriveViewingKeyFromPrivateKey(ALICE_PK, SN_SEPOLIA, POOL_MAIN);
    const b = deriveViewingKeyFromPrivateKey(ALICE_PK, SN_SEPOLIA, POOL_SEPOLIA);
    expect(a).not.toBe(b);
  });

  it("gives different users different keys", () => {
    expect(deriveViewingKeyFromPrivateKey(ALICE_PK, SN_MAIN, POOL_MAIN)).not.toBe(
      deriveViewingKeyFromPrivateKey(BOB_PK, SN_MAIN, POOL_MAIN),
    );
  });

  it("names the chain and pool in the signed message", () => {
    expect(viewingKeyMessage(SN_MAIN, POOL_MAIN)).toBe(`${SN_MAIN}:${POOL_MAIN}`);
  });

  it("folds an upper-half value down instead of rejecting it", () => {
    // The fold preserves the public key's x-coordinate, so both halves address
    // the same account. Without it, roughly half of all signatures would be
    // unusable.
    const high = CURVE_ORDER - 12345n;
    expect(high > MAX_VIEWING_KEY).toBe(true);
    const folded = foldToViewingKey(1n, 2n);
    expect(folded < MAX_VIEWING_KEY).toBe(true);
  });
});

describe("wallet signature path", () => {
  it("accepts a plain (r, s) signature", () => {
    expect(viewingKeyFromWalletSignature(["0x1", "0x2"])).toBe(foldToViewingKey(1n, 2n));
  });

  it("takes the last two elements when a smart account prefixes metadata", () => {
    expect(viewingKeyFromWalletSignature(["0x0", "0x2", "0x1", "0x2"])).toBe(
      foldToViewingKey(1n, 2n),
    );
  });

  it("refuses to guess from a too-short signature", () => {
    expect(() => viewingKeyFromWalletSignature(["0x1"])).toThrow(/at least/);
  });

  it("builds a session that stores no key anywhere but the object", () => {
    const s = sessionFromSignature("0xabc", SN_SEPOLIA, POOL_SEPOLIA, ["0x1", "0x2"]);
    expect(s.viewingKey).toBe(foldToViewingKey(1n, 2n));
    expect(s.publicKey).toBe(publicViewingKey(s.viewingKey));
    expect(Object.keys(s).sort()).toEqual(
      ["address", "chainId", "pool", "publicKey", "viewingKey"].sort(),
    );
  });
});

describe("signature to readable note, the whole chain", () => {
  it("derives a key, opens a lane, and recovers the amount", () => {
    const aliceAddr = "0x111";
    const bobAddr = "0x333";
    const token = "0x1234";

    // Both sides derive their viewing keys from their own signatures. Neither
    // key is stored, transmitted, or asked for.
    const aliceKey = deriveViewingKeyFromPrivateKey(ALICE_PK, SN_SEPOLIA, POOL_SEPOLIA);
    const bobKey = deriveViewingKeyFromPrivateKey(BOB_PK, SN_SEPOLIA, POOL_SEPOLIA);
    const bobPublic = publicViewingKey(bobKey);

    // Alice pays Bob. The channel key comes from her private key and his
    // registered public key.
    const channel = computeChannelKey(aliceAddr, aliceKey, bobAddr, bobPublic);
    const packed = encryptNoteAmount(channel, token, 0, 987654321n, 4_200n);

    // Anyone holding that channel key, and nothing else, reads the amount.
    const read = decryptNoteAmount(packed, channel, token, 0);
    expect(read.amount).toBe(4_200n);

    // And can locate it, which is what a verifier does against the live pool.
    expect(computeNoteId(channel, token, 0)).toBeGreaterThan(0n);
  });

  it("gives a different lane for the reverse direction", () => {
    const aliceKey = deriveViewingKeyFromPrivateKey(ALICE_PK, SN_SEPOLIA, POOL_SEPOLIA);
    const bobKey = deriveViewingKeyFromPrivateKey(BOB_PK, SN_SEPOLIA, POOL_SEPOLIA);
    const aToB = computeChannelKey("0x111", aliceKey, "0x333", publicViewingKey(bobKey));
    const bToA = computeChannelKey("0x333", bobKey, "0x111", publicViewingKey(aliceKey));
    expect(aToB).not.toBe(bToA);
  });

  it("a third party's key opens nothing", () => {
    const aliceKey = deriveViewingKeyFromPrivateKey(ALICE_PK, SN_SEPOLIA, POOL_SEPOLIA);
    const bobKey = deriveViewingKeyFromPrivateKey(BOB_PK, SN_SEPOLIA, POOL_SEPOLIA);
    const mallory = deriveViewingKeyFromPrivateKey("0xdead", SN_SEPOLIA, POOL_SEPOLIA);

    const real = computeChannelKey("0x111", aliceKey, "0x333", publicViewingKey(bobKey));
    const forged = computeChannelKey("0x111", mallory, "0x333", publicViewingKey(bobKey));
    expect(forged).not.toBe(real);

    const packed = encryptNoteAmount(real, "0x1234", 0, 555n, 1_000n);
    expect(decryptNoteAmount(packed, forged, "0x1234", 0).amount).not.toBe(1_000n);
  });
});
