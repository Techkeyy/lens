/**
 * The bug this phase exists to fix.
 *
 * Before: a disclosure carried a reusable key and a total, and verification
 * walked the lane until it ran out of notes. So a payment arriving after
 * authorization joined the "authorized" set, and simultaneously changed the
 * total, which made the Holder's own honest disclosure stop verifying.
 *
 * After: the disclosure freezes a per-lane note count. Verification reads
 * exactly indices 0..count-1. These tests are the proof.
 */

import { describe, expect, it } from "vitest";
import { createDisclosure } from "./disclose";
import { type Direction, type DisclosureResult, verifyDisclosure } from "./claim";
import { disclosureCommitment, makeRequest } from "./bundle";
import { publicViewingKey } from "./session";
import { twoPartyWorld } from "./testing/fakePool";

const lane = (r: DisclosureResult, d: Direction) => r.lanes.find((l) => l.direction === d)!;

const ALICE = "0x0a11ce";
const EMPLOYER = "0x0e11907e2";
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const SEPOLIA = "0x534e5f5345504f4c4941";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

const ALICE_VK = 0x0a11ce5eecen;
const EMPLOYER_VK = 0x0e11907e25ecn;

function world() {
  const w = twoPartyWorld({
    holder: ALICE,
    holderViewingKey: ALICE_VK,
    counterparty: EMPLOYER,
    counterpartyViewingKey: EMPLOYER_VK,
    token: USDC,
  });
  const session = {
    address: ALICE,
    chainId: SEPOLIA,
    pool: POOL,
    viewingKey: ALICE_VK,
    publicKey: publicViewingKey(ALICE_VK),
  };
  const request = makeRequest({
    chainId: SEPOLIA,
    pool: POOL,
    requester: "Northside Lettings",
    purpose: "Proof of salary income",
    counterparty: EMPLOYER,
    token: USDC,
    nonce: "fixed",
  });
  return { ...w, session, request };
}

describe("freezing the snapshot", () => {
  it("records the inbound note count at approval time", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 3000n);
    pool.pay(inbound, USDC, 3000n);
    pool.pay(inbound, USDC, 3200n);

    const preview = await createDisclosure(pool, session, request, { now: 1_000 });
    expect(preview.disclosure.snapshot.inbound).toEqual({ noteCount: 3, total: "9200" });
    expect(preview.disclosure.assertedTotal).toBe("9200");
  });

  it("records the outbound note count too", async () => {
    const { pool, outbound, inbound, session, request } = world();
    pool.pay(inbound, USDC, 3000n);
    pool.pay(outbound, USDC, 250n);
    pool.pay(outbound, USDC, 100n);

    const preview = await createDisclosure(pool, session, request, { now: 1_000 });
    expect(preview.disclosure.snapshot.outbound).toEqual({ noteCount: 2, total: "350" });
    expect(preview.disclosure.snapshot.inbound).toEqual({ noteCount: 1, total: "3000" });
    expect(preview.disclosure.assertedTotal).toBe("3350");
    expect(preview.disclosure.directions).toEqual(["outbound", "inbound"]);
  });

  it("verifies straight after creation", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 500n);

    const { disclosure } = await createDisclosure(pool, session, request, { now: 1_000 });
    const r = await verifyDisclosure(pool, disclosure);
    expect(r.verified).toBe(true);
    expect(r.total).toBe(500n);
    expect(r.laterActivityDetected).toBe(false);
  });
});

describe("payments arriving after authorization", () => {
  it("does not invalidate the authorized disclosure", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 3000n);
    pool.pay(inbound, USDC, 3000n);
    const { disclosure } = await createDisclosure(pool, session, request, { now: 1_000 });

    // Payday happens again, long after the landlord got the proof.
    pool.pay(inbound, USDC, 3000n);

    const r = await verifyDisclosure(pool, disclosure);
    expect(r.verified).toBe(true);
    expect(r.total).toBe(6000n);
  });

  it("does not become part of the authorized total", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 100n);
    const { disclosure } = await createDisclosure(pool, session, request, { now: 1_000 });
    pool.pay(inbound, USDC, 999_999n);

    const r = await verifyDisclosure(pool, disclosure);
    expect(r.total).toBe(100n);
    expect(lane(r, "inbound").notes).toHaveLength(1);
  });

  it("is reported as later activity, not hidden", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 100n);
    const { disclosure } = await createDisclosure(pool, session, request, { now: 1_000 });
    pool.pay(inbound, USDC, 200n);
    pool.pay(inbound, USDC, 300n);

    const r = await verifyDisclosure(pool, disclosure);
    expect(r.laterActivityDetected).toBe(true);
    expect(lane(r, "inbound").laterNoteCount).toBe(2);
  });

  it("holds for the outbound direction as well", async () => {
    const { pool, outbound, session, request } = world();
    pool.pay(outbound, USDC, 50n);
    const { disclosure } = await createDisclosure(pool, session, request, { now: 1_000 });
    pool.pay(outbound, USDC, 5000n);

    const r = await verifyDisclosure(pool, disclosure);
    expect(r.verified).toBe(true);
    expect(r.total).toBe(50n);
    expect(r.laterActivityDetected).toBe(true);
  });
});

describe("tampering inside the authorized range", () => {
  it("fails when a note in range is missing", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 100n);
    pool.pay(inbound, USDC, 200n);
    const { disclosure } = await createDisclosure(pool, session, request, { now: 1_000 });

    pool.deleteNote(inbound, USDC, 1);
    const r = await verifyDisclosure(pool, disclosure);
    expect(r.verified).toBe(false);
    expect(r.failure).toBe("missing-note");
    expect(r.reason).toContain("payment 2");
  });

  it("fails when an amount in range changed", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 100n);
    const { disclosure } = await createDisclosure(pool, session, request, { now: 1_000 });

    pool.rewriteAmount(inbound, USDC, 0, 999n);
    const r = await verifyDisclosure(pool, disclosure);
    expect(r.verified).toBe(false);
    expect(r.failure).toBe("lane-total-mismatch");
  });

  it("fails when the disclosure inflates its own snapshot count", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 100n);
    const { disclosure } = await createDisclosure(pool, session, request, { now: 1_000 });

    const greedy = {
      ...disclosure,
      snapshot: { ...disclosure.snapshot, inbound: { noteCount: 5, total: "100" } },
    };
    const r = await verifyDisclosure(pool, greedy);
    expect(r.verified).toBe(false);
    expect(r.failure).toBe("missing-note");
  });

  it("fails when the disclosure inflates its own total", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 100n);
    const { disclosure } = await createDisclosure(pool, session, request, { now: 1_000 });

    const inflated = {
      ...disclosure,
      snapshot: { ...disclosure.snapshot, inbound: { noteCount: 1, total: "50000" } },
    };
    const r = await verifyDisclosure(pool, inflated);
    expect(r.failure).toBe("lane-total-mismatch");
  });
});

describe("determinism and shape", () => {
  it("keeps both lanes in canonical order", async () => {
    const { pool, outbound, inbound, session, request } = world();
    pool.pay(inbound, USDC, 1n);
    pool.pay(outbound, USDC, 2n);
    const { disclosure } = await createDisclosure(pool, session, request, { now: 1_000 });
    const r = await verifyDisclosure(pool, disclosure);
    expect(r.lanes.map((l) => l.direction)).toEqual(["outbound", "inbound"]);
  });

  it("produces the same commitment for the same state and time", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 7n);
    const a = await createDisclosure(pool, session, request, { now: 42 });
    const b = await createDisclosure(pool, session, request, { now: 42 });
    expect(a.commitment).toBe(b.commitment);
    expect(a.commitment).toBe(disclosureCommitment(a.disclosure));
  });

  it("reports an empty relationship instead of authorizing nothing quietly", async () => {
    const { pool, session, request } = world();
    const preview = await createDisclosure(pool, session, request, { now: 1_000 });
    expect(preview.empty).toBe(true);
    expect(preview.warnings.join(" ")).toContain("No payments were found");
  });

  it("refuses a request for another network", async () => {
    const { pool, session, request } = world();
    await expect(
      createDisclosure(pool, session, { ...request, chainId: "0x534e5f4d41494e" }),
    ).rejects.toThrow(/different network/);
  });

  it("refuses a disclosure about yourself", async () => {
    const { pool, session, request } = world();
    await expect(
      createDisclosure(pool, session, { ...request, counterparty: ALICE }),
    ).rejects.toThrow(/about yourself/);
  });
});

describe("consent warnings", () => {
  it("always names the bearer and reusable-key limits", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 1n);
    const { warnings } = await createDisclosure(pool, session, request, { now: 1 });
    const all = warnings.join(" ");
    expect(all).toContain("bearer credential");
    expect(all).toContain("keeps working");
    expect(all).toContain("cannot be narrowed to a single payment");
    expect(all).toContain("not a cryptographic constraint");
  });

  it("never puts the master viewing key in the disclosure", async () => {
    const { pool, inbound, session, request } = world();
    pool.pay(inbound, USDC, 1n);
    const { disclosure } = await createDisclosure(pool, session, request, { now: 1 });
    const serialized = JSON.stringify(disclosure);
    expect(serialized).not.toContain(ALICE_VK.toString(16));
    expect(serialized).not.toContain(ALICE_VK.toString());
  });
});

describe("empty lanes are not disclosed", () => {
  it("leaves out a lane with no payments, so its reusable key is never shared", async () => {
    const { pool, inbound, session, request } = world();
    // Only inbound has payments. The outbound lane exists but is empty.
    pool.pay(inbound, USDC, 100n);

    const { disclosure } = await createDisclosure(pool, session, request, { now: 1 });
    expect(disclosure.directions).toEqual(["inbound"]);
    expect(disclosure.keys.outbound).toBeUndefined();
    expect(disclosure.snapshot.outbound).toBeUndefined();
    // Sharing an empty lane's key would expose future payments in a direction
    // where nothing has happened yet.
    expect(JSON.stringify(disclosure)).not.toContain("outbound");
  });

  it("still includes both when both have payments", async () => {
    const { pool, inbound, outbound, session, request } = world();
    pool.pay(inbound, USDC, 100n);
    pool.pay(outbound, USDC, 50n);
    const { disclosure } = await createDisclosure(pool, session, request, { now: 1 });
    expect(disclosure.directions).toEqual(["outbound", "inbound"]);
  });
});
