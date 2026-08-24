/**
 * Identity binding, which is what stops a disclosure from being a lie.
 *
 * A channel key proves notes exist somewhere. It says nothing about who paid
 * whom. These tests cover the cases where someone tries to exploit that gap.
 *
 * Snapshot behaviour lives in snapshot.test.ts.
 */

import { describe, expect, it } from "vitest";
import { WARNINGS, exposure, verifyDisclosure } from "./claim";
import { DISCLOSURE_SCHEME, type Disclosure } from "./bundle";
import { computeChannelKey } from "./derive";
import { publicViewingKey } from "./session";
import { FakePool, twoPartyWorld } from "./testing/fakePool";

const ALICE = "0x0a11ce";
const EMPLOYER = "0x0e11907e2";
const MALLORY = "0x0badbad";
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const ALICE_VK = 0x0a11ce5eecen;
const EMPLOYER_VK = 0x0e11907e25ecn;

function disclosureFor(keys: Disclosure["keys"], snapshot: Disclosure["snapshot"], total: string): Disclosure {
  return {
    scheme: DISCLOSURE_SCHEME,
    chainId: "0x534e5f5345504f4c4941",
    pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
    requestCommitment: "0x0",
    scope: { holder: ALICE, counterparty: EMPLOYER, token: USDC },
    directions: (["outbound", "inbound"] as const).filter((d) => keys[d] !== undefined),
    keys,
    snapshot,
    assertedTotal: total,
    createdAt: 1_724_000_000,
  };
}

const hex = (v: bigint) => "0x" + v.toString(16);

describe("identity binding", () => {
  it("verifies a lane the pool attests to", async () => {
    const { pool, inbound } = twoPartyWorld({
      holder: ALICE,
      holderViewingKey: ALICE_VK,
      counterparty: EMPLOYER,
      counterpartyViewingKey: EMPLOYER_VK,
      token: USDC,
    });
    pool.pay(inbound, USDC, 3000n);
    const r = await verifyDisclosure(
      pool,
      disclosureFor({ inbound: hex(inbound) }, { inbound: { noteCount: 1, total: "3000" } }, "3000"),
    );
    expect(r.verified).toBe(true);
    expect(r.identityBound).toBe(true);
  });

  it("refuses a lane funded by a third party and attributed to the employer", async () => {
    // Mallory opens her own lane to Alice, funds it, and Alice tries to pass it
    // off as the employer paying her. The notes are real; the attribution is not.
    const pool = new FakePool();
    const alicePub = pool.register(ALICE, ALICE_VK);
    pool.register(EMPLOYER, EMPLOYER_VK);
    const forged = computeChannelKey(MALLORY, 0x9999n, ALICE, alicePub);
    pool.openLane(
      { key: forged, sender: MALLORY, recipient: ALICE, recipientPub: alicePub },
      USDC,
    );
    pool.pay(forged, USDC, 50_000n);

    const r = await verifyDisclosure(
      pool,
      disclosureFor({ inbound: hex(forged) }, { inbound: { noteCount: 1, total: "50000" } }, "50000"),
    );
    expect(r.verified).toBe(false);
    expect(r.failure).toBe("lane-not-in-pool");
    expect(r.identityBound).toBe(false);
  });

  it("refuses an inbound key presented as an outbound one", async () => {
    const { pool, inbound } = twoPartyWorld({
      holder: ALICE,
      holderViewingKey: ALICE_VK,
      counterparty: EMPLOYER,
      counterpartyViewingKey: EMPLOYER_VK,
      token: USDC,
    });
    pool.pay(inbound, USDC, 500n);
    const r = await verifyDisclosure(
      pool,
      disclosureFor({ outbound: hex(inbound) }, { outbound: { noteCount: 1, total: "500" } }, "500"),
    );
    expect(r.failure).toBe("lane-not-in-pool");
  });

  it("refuses a counterparty that never registered", async () => {
    const pool = new FakePool();
    pool.register(ALICE, ALICE_VK);
    const r = await verifyDisclosure(
      pool,
      disclosureFor({ outbound: "0xabc" }, { outbound: { noteCount: 0, total: "0" } }, "0"),
    );
    expect(r.failure).toBe("unregistered-counterparty");
  });

  it("refuses a holder that never registered", async () => {
    const pool = new FakePool();
    pool.register(EMPLOYER, EMPLOYER_VK);
    const r = await verifyDisclosure(
      pool,
      disclosureFor({ inbound: "0xabc" }, { inbound: { noteCount: 0, total: "0" } }, "0"),
    );
    expect(r.failure).toBe("unregistered-holder");
  });

  it("refuses a disclosure with no lanes", async () => {
    const r = await verifyDisclosure(new FakePool(), disclosureFor({}, {}, "0"));
    expect(r.failure).toBe("no-lanes");
  });

  it("refuses a key with no snapshot boundary behind it", async () => {
    const { pool, inbound } = twoPartyWorld({
      holder: ALICE,
      holderViewingKey: ALICE_VK,
      counterparty: EMPLOYER,
      counterpartyViewingKey: EMPLOYER_VK,
      token: USDC,
    });
    pool.pay(inbound, USDC, 1n);
    const r = await verifyDisclosure(pool, disclosureFor({ inbound: hex(inbound) }, {}, "1"));
    expect(r.failure).toBe("empty-snapshot");
  });

  it("cannot reach a different counterparty's relationship", async () => {
    const { pool, inbound } = twoPartyWorld({
      holder: ALICE,
      holderViewingKey: ALICE_VK,
      counterparty: EMPLOYER,
      counterpartyViewingKey: EMPLOYER_VK,
      token: USDC,
    });
    const otherClient = computeChannelKey("0x0c11e17", 0x5555n, ALICE, publicViewingKey(ALICE_VK));
    pool.pay(inbound, USDC, 100n);
    pool.pay(otherClient, USDC, 999_999n);

    const r = await verifyDisclosure(
      pool,
      disclosureFor({ inbound: hex(inbound) }, { inbound: { noteCount: 1, total: "100" } }, "100"),
    );
    expect(r.verified).toBe(true);
    expect(r.total).toBe(100n);
  });
});

describe("consent wording", () => {
  it("warns when the relationship is wider than the question", () => {
    const w = exposure([{ direction: "inbound", noteCount: 6 }], { noteCount: 4 }).join(" ");
    expect(w).toContain("asked about 4");
    expect(w).toContain("contains 6");
  });

  it("says when both directions are included", () => {
    const w = exposure([
      { direction: "outbound", noteCount: 1 },
      { direction: "inbound", noteCount: 1 },
    ]).join(" ");
    expect(w).toContain("Both directions");
  });

  it("always states relationship scope, bearer nature and key reuse", () => {
    const w = exposure([{ direction: "inbound", noteCount: 2 }]).join(" ");
    expect(w).toContain("cannot be narrowed to a single payment");
    expect(w).toContain("bearer credential");
    expect(w).toContain("keeps working");
  });

  it("never promises that revocation erases anything", () => {
    expect(WARNINGS.revocation).toContain("cannot erase");
    expect(WARNINGS.revocation).not.toMatch(/stops working|expires|disabled/i);
  });

  it("does not claim dates are proven", () => {
    expect(WARNINGS.noProvenDates).toContain("not a cryptographic constraint");
  });
});
