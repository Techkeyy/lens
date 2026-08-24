/**
 * The security boundary, tested.
 *
 * The cases that matter are the dishonest ones. A Holder who funds a lane of
 * their own and presents it as someone else's payment must fail. A disclosure
 * whose numbers do not match the chain must fail. And a disclosure must never
 * be able to reach a relationship it does not name.
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
import { exposure, verifyDisclosure } from "./claim";

const ALICE = "0x0a11ce"; // Holder
const ALICE_VK = "0x0a11cekey".replace("key", "");
const EMPLOYER = "0x0e11907e2"; // Counterparty
const LANDLORD = "0x01a4d10rd".replace("rd", ""); // Verifier, holds no keys
const MALLORY = "0x0badbad";
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

const ALICE_VIEWING = 0x11111n;
const ALICE_PUB = 0x22222n;
const EMPLOYER_VIEWING = 0x33333n;
const EMPLOYER_PUB = 0x44444n;

/** Employer -> Alice. Alice recovers this by ECDH in the real flow. */
const INBOUND = computeChannelKey(EMPLOYER, EMPLOYER_VIEWING, ALICE, ALICE_PUB);
/** Alice -> Employer. */
const OUTBOUND = computeChannelKey(ALICE, ALICE_VIEWING, EMPLOYER, EMPLOYER_PUB);

type Lane = { key: bigint; sender: Felt; recipient: Felt; recipientPub: bigint };
type Note = { key: bigint; index: number; amount: bigint };

/** A pool that only recognises lanes actually registered to a given pair. */
function fakePool(opts: {
  lanes?: Lane[];
  notes?: Note[];
  publicKeys?: Record<string, bigint>;
  token?: Felt;
}): NoteReader {
  const token = opts.token ?? USDC;
  const channels = new Set(
    (opts.lanes ?? []).map((l) =>
      computeChannelMarker(l.key, l.sender, l.recipient, l.recipientPub).toString(),
    ),
  );
  const subchannels = new Set(
    (opts.lanes ?? []).map((l) =>
      computeSubchannelMarker(l.key, l.recipient, l.recipientPub, token).toString(),
    ),
  );
  const store = new Map<string, StoredNote>();
  for (const n of opts.notes ?? []) {
    const noteId = computeNoteId(n.key, token, n.index);
    store.set(noteId.toString(), {
      index: -1,
      noteId,
      packedValue: encryptNoteAmount(n.key, token, n.index, BigInt(77 + n.index), n.amount),
      storedToken: 0n,
    });
  }
  const keys = opts.publicKeys ?? {
    [BigInt(ALICE).toString()]: ALICE_PUB,
    [BigInt(EMPLOYER).toString()]: EMPLOYER_PUB,
  };
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
    async getNumOfChannels() {
      return 0;
    },
    async getChannelInfo() {
      return { ephemeralPubkey: 0n, encChannelKey: 0n, encSenderAddr: 0n };
    },
  };
}

const inboundLane: Lane = {
  key: INBOUND,
  sender: EMPLOYER,
  recipient: ALICE,
  recipientPub: ALICE_PUB,
};
const outboundLane: Lane = {
  key: OUTBOUND,
  sender: ALICE,
  recipient: EMPLOYER,
  recipientPub: EMPLOYER_PUB,
};

const scope = { holder: ALICE, counterparty: EMPLOYER, token: USDC };
const hex = (v: bigint) => "0x" + v.toString(16);

describe("verifyDisclosure, salary received", () => {
  it("verifies three payments from the employer", async () => {
    const pool = fakePool({
      lanes: [inboundLane],
      notes: [
        { key: INBOUND, index: 0, amount: 3000n },
        { key: INBOUND, index: 1, amount: 3000n },
        { key: INBOUND, index: 2, amount: 3200n },
      ],
    });
    const r = await verifyDisclosure(pool, scope, { inbound: hex(INBOUND) }, 9200n);
    expect(r.verified).toBe(true);
    expect(r.identityBound).toBe(true);
    expect(r.lanes[0].direction).toBe("inbound");
    expect(r.lanes[0].notes).toHaveLength(3);
    expect(r.total).toBe(9200n);
  });

  it("rejects a total that does not match the chain, and reports the real one", async () => {
    const pool = fakePool({
      lanes: [inboundLane],
      notes: [{ key: INBOUND, index: 0, amount: 3000n }],
    });
    const r = await verifyDisclosure(pool, scope, { inbound: hex(INBOUND) }, 99999n);
    expect(r.verified).toBe(false);
    expect(r.failure).toBe("total-mismatch");
    expect(r.total).toBe(3000n);
  });
});

describe("both directions", () => {
  it("combines received and sent into one relationship", async () => {
    const pool = fakePool({
      lanes: [inboundLane, outboundLane],
      notes: [
        { key: INBOUND, index: 0, amount: 3000n },
        { key: OUTBOUND, index: 0, amount: 250n },
      ],
    });
    const r = await verifyDisclosure(
      pool,
      scope,
      { inbound: hex(INBOUND), outbound: hex(OUTBOUND) },
      3250n,
    );
    expect(r.verified).toBe(true);
    expect(r.lanes.map((l) => l.direction)).toEqual(["outbound", "inbound"]);
    expect(r.total).toBe(3250n);
  });

  it("accepts a relationship where money only ever flowed one way", async () => {
    const pool = fakePool({
      lanes: [inboundLane],
      notes: [{ key: INBOUND, index: 0, amount: 500n }],
    });
    const r = await verifyDisclosure(pool, scope, { inbound: hex(INBOUND) }, 500n);
    expect(r.verified).toBe(true);
    expect(r.lanes).toHaveLength(1);
  });

  it("refuses an inbound key presented as an outbound one", async () => {
    // Same key, wrong direction. The marker will not exist, because the pool
    // registered it for employer -> alice, not alice -> employer.
    const pool = fakePool({
      lanes: [inboundLane],
      notes: [{ key: INBOUND, index: 0, amount: 500n }],
    });
    const r = await verifyDisclosure(pool, scope, { outbound: hex(INBOUND) }, 500n);
    expect(r.verified).toBe(false);
    expect(r.failure).toBe("lane-not-in-pool");
  });
});

describe("forgery", () => {
  it("refuses a lane funded by someone else and attributed to the employer", async () => {
    const forged = computeChannelKey(MALLORY, 0x9999n, ALICE, ALICE_PUB);
    const pool = fakePool({
      lanes: [{ key: forged, sender: MALLORY, recipient: ALICE, recipientPub: ALICE_PUB }],
      notes: [{ key: forged, index: 0, amount: 50000n }],
    });
    const r = await verifyDisclosure(pool, scope, { inbound: hex(forged) }, 50000n);
    expect(r.verified).toBe(false);
    expect(r.failure).toBe("lane-not-in-pool");
    expect(r.identityBound).toBe(false);
  });

  it("refuses a counterparty that never registered", async () => {
    const pool = fakePool({ publicKeys: { [BigInt(ALICE).toString()]: ALICE_PUB } });
    const r = await verifyDisclosure(pool, scope, { outbound: hex(OUTBOUND) }, 0n);
    expect(r.failure).toBe("unregistered-counterparty");
  });

  it("refuses a holder that never registered", async () => {
    const pool = fakePool({ publicKeys: { [BigInt(EMPLOYER).toString()]: EMPLOYER_PUB } });
    const r = await verifyDisclosure(pool, scope, { inbound: hex(INBOUND) }, 0n);
    expect(r.failure).toBe("unregistered-holder");
  });

  it("refuses a disclosure with no lanes at all", async () => {
    const r = await verifyDisclosure(fakePool({}), scope, {}, 0n);
    expect(r.failure).toBe("no-lanes");
  });

  it("reports an empty relationship rather than pretending it verified", async () => {
    const pool = fakePool({ lanes: [inboundLane] });
    const r = await verifyDisclosure(pool, scope, { inbound: hex(INBOUND) }, 0n);
    expect(r.verified).toBe(false);
    expect(r.failure).toBe("no-notes");
    expect(r.identityBound).toBe(true);
  });

  it("cannot reach a different counterparty's relationship", async () => {
    // Alice also has a lane with a second employer. Disclosing the first must
    // not expose the second, and the keys are unrelated.
    const other = computeChannelKey("0x0c11e17", 0x5555n, ALICE, ALICE_PUB);
    expect(other).not.toBe(INBOUND);
    const pool = fakePool({
      lanes: [inboundLane],
      notes: [
        { key: INBOUND, index: 0, amount: 100n },
        { key: other, index: 0, amount: 999999n },
      ],
    });
    const r = await verifyDisclosure(pool, scope, { inbound: hex(INBOUND) }, 100n);
    expect(r.verified).toBe(true);
    expect(r.total).toBe(100n);
  });
});

describe("exposure preview", () => {
  const lanes = [
    { direction: "inbound" as const, notes: [{}, {}, {}, {}, {}, {}] as never[], total: 6n },
  ];

  it("warns when the relationship is wider than the period asked about", () => {
    const w = exposure(lanes, { noteCount: 4 }).join(" ");
    expect(w).toContain("asked about 4");
    expect(w).toContain("contains 6");
    expect(w).toContain("relationship level, not payment level");
  });

  it("says when both directions are included", () => {
    const both = [
      { direction: "outbound" as const, notes: [{}] as never[], total: 1n },
      { direction: "inbound" as const, notes: [{}] as never[], total: 1n },
    ];
    expect(exposure(both).join(" ")).toContain("Both directions");
  });

  it("always states the relationship-level limit", () => {
    expect(exposure(lanes).join(" ")).toContain("cannot be narrowed to a single payment");
  });
});
