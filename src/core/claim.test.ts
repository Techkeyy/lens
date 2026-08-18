/**
 * Claim verification, against an in-memory pool that enforces the same
 * identity binding the real one does.
 *
 * The case that matters most is "forged lane": a discloser who invents a
 * channel key that happens to hold notes must not be able to pass it off as a
 * payment from someone they name.
 */

import { describe, expect, it } from "vitest";
import {
  computeChannelKey,
  computeChannelMarker,
  computeNoteId,
  computeSubchannelMarker,
  encryptNoteAmount,
  type Felt,
} from "./derive";
import type { NoteReader, StoredNote } from "./read";
import { verifyRelationship, overreach } from "./claim";

const ALICE = "0x111";
const ALICE_PRIV = "0x222";
const BOB = "0x333";
const BOB_PUB = "0x444";
const TOKEN = "0x1234";

const CHANNEL = computeChannelKey(ALICE, ALICE_PRIV, BOB, BOB_PUB);

/**
 * A pool that registers channels the way the real one does, so a channel key
 * only "belongs" to a pair if it was registered for that pair.
 */
function fakePool(opts: {
  registered?: { channelKey: bigint; sender: Felt; recipient: Felt; recipientPub: Felt }[];
  tokens?: { channelKey: bigint; recipient: Felt; recipientPub: Felt; token: Felt }[];
  notes?: { channelKey: bigint; token: Felt; index: number; amount: bigint }[];
  publicKeys?: Record<string, bigint>;
}): NoteReader {
  const channels = new Set(
    (opts.registered ?? []).map((r) =>
      computeChannelMarker(r.channelKey, r.sender, r.recipient, r.recipientPub).toString(),
    ),
  );
  const subchannels = new Set(
    (opts.tokens ?? []).map((t) =>
      computeSubchannelMarker(t.channelKey, t.recipient, t.recipientPub, t.token).toString(),
    ),
  );
  const store = new Map<string, StoredNote>();
  for (const n of opts.notes ?? []) {
    const noteId = computeNoteId(n.channelKey, n.token, n.index);
    store.set(noteId.toString(), {
      index: -1,
      noteId,
      packedValue: encryptNoteAmount(n.channelKey, n.token, n.index, BigInt(99 + n.index), n.amount),
      storedToken: 0n,
    });
  }
  const keys = opts.publicKeys ?? { [BigInt(BOB).toString()]: BigInt(BOB_PUB) };
  return {
    async getNote(id) {
      return store.get(BigInt(id).toString());
    },
    async nullifierExists() {
      return false;
    },
    async getPublicKey(addr) {
      return keys[BigInt(addr).toString()] ?? 0n;
    },
    async channelExists(m) {
      return channels.has(BigInt(m).toString());
    },
    async subchannelExists(m) {
      return subchannels.has(BigInt(m).toString());
    },
  };
}

/** A pool where Alice really did pay Bob 100 then 250. */
function honestPool() {
  return fakePool({
    registered: [
      { channelKey: CHANNEL, sender: ALICE, recipient: BOB, recipientPub: BOB_PUB },
    ],
    tokens: [{ channelKey: CHANNEL, recipient: BOB, recipientPub: BOB_PUB, token: TOKEN }],
    notes: [
      { channelKey: CHANNEL, token: TOKEN, index: 0, amount: 100n },
      { channelKey: CHANNEL, token: TOKEN, index: 1, amount: 250n },
    ],
  });
}

const scope = { sender: ALICE, recipient: BOB, token: TOKEN };

describe("verifyRelationship", () => {
  it("verifies an honest disclosure", async () => {
    const r = await verifyRelationship(honestPool(), CHANNEL, {
      kind: "relationship",
      scope,
      assertedTotal: 350n,
    });
    expect(r.verified).toBe(true);
    expect(r.identityBound).toBe(true);
    expect(r.total).toBe(350n);
    expect(r.notes).toHaveLength(2);
  });

  it("checks per-note amounts when they are asserted", async () => {
    const r = await verifyRelationship(honestPool(), CHANNEL, {
      kind: "relationship",
      scope,
      assertedTotal: 350n,
      assertedAmounts: [100n, 250n],
    });
    expect(r.verified).toBe(true);
  });

  it("rejects a total that does not match the chain", async () => {
    const r = await verifyRelationship(honestPool(), CHANNEL, {
      kind: "relationship",
      scope,
      assertedTotal: 999n,
    });
    expect(r.verified).toBe(false);
    expect(r.failure).toBe("total-mismatch");
    // The real number is still reported, so the verifier learns the truth.
    expect(r.total).toBe(350n);
  });

  it("rejects reordered or altered per-note amounts", async () => {
    const r = await verifyRelationship(honestPool(), CHANNEL, {
      kind: "relationship",
      scope,
      assertedTotal: 350n,
      assertedAmounts: [250n, 100n],
    });
    expect(r.failure).toBe("amounts-mismatch");
  });

  it("refuses a forged lane that names someone who never paid", async () => {
    // Mallory builds her own channel to Bob, funds it, and tries to pass it
    // off as Alice paying Bob. The notes are real; the attribution is not.
    const MALLORY = "0x999";
    const forged = computeChannelKey(MALLORY, "0xaaa", BOB, BOB_PUB);
    const pool = fakePool({
      registered: [
        { channelKey: forged, sender: MALLORY, recipient: BOB, recipientPub: BOB_PUB },
      ],
      tokens: [{ channelKey: forged, recipient: BOB, recipientPub: BOB_PUB, token: TOKEN }],
      notes: [{ channelKey: forged, token: TOKEN, index: 0, amount: 5000n }],
    });
    const r = await verifyRelationship(pool, forged, {
      kind: "relationship",
      scope, // claims Alice sent it
      assertedTotal: 5000n,
    });
    expect(r.verified).toBe(false);
    expect(r.failure).toBe("channel-not-in-pool");
    expect(r.identityBound).toBe(false);
  });

  it("refuses a recipient who never registered a viewing key", async () => {
    const r = await verifyRelationship(fakePool({ publicKeys: {} }), CHANNEL, {
      kind: "relationship",
      scope,
      assertedTotal: 0n,
    });
    expect(r.failure).toBe("unregistered-recipient");
  });

  it("reports a registered lane that holds nothing in this token", async () => {
    const pool = fakePool({
      registered: [
        { channelKey: CHANNEL, sender: ALICE, recipient: BOB, recipientPub: BOB_PUB },
      ],
    });
    const r = await verifyRelationship(pool, CHANNEL, {
      kind: "relationship",
      scope,
      assertedTotal: 0n,
    });
    expect(r.failure).toBe("subchannel-not-in-pool");
    expect(r.identityBound).toBe(true);
  });
});

describe("overreach", () => {
  it("warns when the key opens more payments than were asked about", async () => {
    const r = await verifyRelationship(honestPool(), CHANNEL, {
      kind: "relationship",
      scope,
      assertedTotal: 350n,
    });
    const warnings = overreach(r.notes, { maxNotes: 1 });
    expect(warnings[0]).toContain("only 1 were asked about");
  });

  it("always states the channel granularity limit", async () => {
    const r = await verifyRelationship(honestPool(), CHANNEL, {
      kind: "relationship",
      scope,
      assertedTotal: 350n,
    });
    expect(overreach(r.notes).join(" ")).toContain("whole lane");
  });
});
