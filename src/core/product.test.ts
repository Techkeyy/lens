/**
 * The product surface, tested at the layer the screens actually call.
 *
 * These cover the decisions a component must never re-implement: which verdict
 * a verifier sees, how later activity is described, what a request link
 * accepts, and the invariants that must survive any redesign.
 */

import { describe, expect, it } from "vitest";
import { DisclosureStatus } from "./registry";
import {
  LATER_ACTIVITY,
  STATUS_ROW_LABEL,
  formatAmount,
  isAddressLike,
  sameAddress,
  shortAddress,
  summarize,
  tokenInfo,
  verdictFor,
} from "./view";
import { DISCLOSURE_SCHEME, type Disclosure, encodeLink, decodeRequest, makeRequest } from "./bundle";
import { buildProofLink, parseProofLink } from "./transport";
import type { DisclosureResult } from "./claim";
import { createDisclosure } from "./disclose";
import { publicViewingKey } from "./session";
import { twoPartyWorld } from "./testing/fakePool";

const SEPOLIA = "0x534e5f5345504f4c4941";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const ALICE = "0x0a11ce";
const EMPLOYER = "0x0e11907e2";

const ok = (over: Partial<DisclosureResult> = {}): DisclosureResult => ({
  verified: true,
  reason: "fine",
  lanes: [],
  total: 0n,
  identityBound: true,
  laterActivityDetected: false,
  ...over,
});

describe("request form rules", () => {
  it("accepts a Starknet address", () => {
    expect(isAddressLike("0x56d8c42a83dc976ea0bf367639c0b5ce4f42ea262ae8d1a046f710e13659124")).toBe(
      true,
    );
  });

  it("rejects text that is not an address", () => {
    expect(isAddressLike("not an address")).toBe(false);
    expect(isAddressLike("0x")).toBe(false);
    expect(isAddressLike("0xzzzz")).toBe(false);
    expect(isAddressLike("")).toBe(false);
  });

  it("rejects the zero address, which would name nobody", () => {
    expect(isAddressLike("0x0")).toBe(false);
  });

  it("treats padded and unpadded forms as the same address", () => {
    expect(sameAddress("0x0a11ce", "0xa11ce")).toBe(true);
    expect(sameAddress("0x0a11ce", "0x0badbad")).toBe(false);
  });

  it("round trips a request through a link", () => {
    const request = makeRequest({
      chainId: SEPOLIA,
      pool: POOL,
      requester: "Northside Lettings",
      purpose: "Proof of income",
      counterparty: EMPLOYER,
      token: USDC,
    });
    expect(decodeRequest(encodeLink(request))).toEqual(request);
  });

  it("refuses a request link that is not a request", () => {
    expect(() => decodeRequest("bm90LWEtcmVxdWVzdA")).toThrow();
  });
});

describe("verifier verdicts", () => {
  it("does not collapse the states", () => {
    expect(verdictFor(ok(), DisclosureStatus.Active).verdict).toBe("verified");
    expect(verdictFor(ok(), DisclosureStatus.Revoked).verdict).toBe("revoked");
    expect(verdictFor(ok(), DisclosureStatus.Expired).verdict).toBe("expired");
    expect(verdictFor(ok(), DisclosureStatus.Unknown).verdict).toBe("not-authorized");
  });

  it("calls a failed pool check invalid whatever the registry says", () => {
    const bad = ok({ verified: false, reason: "The chain says 5, this claims 9." });
    for (const status of [DisclosureStatus.Active, DisclosureStatus.Revoked]) {
      const v = verdictFor(bad, status);
      expect(v.verdict).toBe("invalid");
      expect(v.tone).toBe("bad");
    }
  });

  it("treats a missing result as invalid rather than pending", () => {
    expect(verdictFor(undefined, DisclosureStatus.Active).verdict).toBe("invalid");
  });

  it("gives every verdict a tone that is not the only signal", () => {
    for (const status of [
      DisclosureStatus.Active,
      DisclosureStatus.Revoked,
      DisclosureStatus.Expired,
      DisclosureStatus.Unknown,
    ]) {
      const v = verdictFor(ok(), status);
      expect(v.headline.length).toBeGreaterThan(3);
      expect(v.detail.length).toBeGreaterThan(10);
    }
  });

  it("never says a revoked disclosure stopped working", () => {
    const v = verdictFor(ok(), DisclosureStatus.Revoked);
    expect(`${v.headline} ${v.detail}`).not.toMatch(/stops? working|no longer accessible|erased/i);
  });

  it("describes expiry as the authorization expiring", () => {
    const v = verdictFor(ok(), DisclosureStatus.Expired);
    expect(v.headline).toMatch(/authorization expired/i);
  });
});

describe("later activity", () => {
  it("is described without a count, because the scan is bounded", () => {
    const words = `${LATER_ACTIVITY.headline} ${LATER_ACTIVITY.detail}`;
    expect(words).not.toMatch(/\d+\s+(later|additional|more)\s+payment/i);
    expect(words).toMatch(/not part of the disclosure/i);
  });

  it("says it is excluded from the totals", () => {
    expect(LATER_ACTIVITY.detail).toMatch(/not included in any total/i);
  });
});

describe("amount and address presentation", () => {
  it("scales by the token's decimals", () => {
    expect(formatAmount(4_800_000_000n, 6)).toBe("4,800");
    expect(formatAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatAmount(10n ** 18n, 18)).toBe("1");
  });

  it("names the tokens it knows and falls back to an address", () => {
    expect(tokenInfo(USDC).symbol).toBe("USDC");
    expect(tokenInfo(USDC).decimals).toBe(6);
    expect(tokenInfo("0xdeadbeef").symbol).toContain("…");
  });

  it("truncates addresses without losing the ends", () => {
    const short = shortAddress("0x56d8c42a83dc976ea0bf367639c0b5ce4f42ea262ae8d1a046f710e13659124");
    expect(short.startsWith("0x")).toBe(true);
    expect(short).toContain("…");
    expect(short.endsWith("9124")).toBe(true);
  });

  it("never invents a human label for an address", () => {
    expect(shortAddress("0x0e11907e2")).not.toMatch(/employer|company/i);
  });

  it("summarises a disclosure for display without touching the keys", () => {
    const d: Disclosure = {
      scheme: DISCLOSURE_SCHEME,
      chainId: SEPOLIA,
      pool: POOL,
      requestCommitment: "0x0",
      scope: { holder: ALICE, counterparty: EMPLOYER, token: USDC },
      directions: ["inbound"],
      keys: { inbound: "0xsecret".replace("secret", "5ec4e7") },
      snapshot: { inbound: { noteCount: 6, total: "4800000000" } },
      assertedTotal: "4800000000",
      createdAt: 1_724_000_000,
    };
    const s = summarize(d);
    expect(s.symbol).toBe("USDC");
    expect(s.noteCount).toBe(6);
    expect(s.total).toBe("4,800");
    expect(JSON.stringify(s)).not.toContain("5ec4e7");
  });
});

describe("status labels", () => {
  it("has a plain word for every state", () => {
    expect(STATUS_ROW_LABEL[DisclosureStatus.Active]).toBe("Active");
    expect(STATUS_ROW_LABEL[DisclosureStatus.Revoked]).toBe("Revoked");
    expect(STATUS_ROW_LABEL[DisclosureStatus.Expired]).toBe("Expired");
    expect(STATUS_ROW_LABEL[DisclosureStatus.Unknown]).toBe("Unknown");
  });
});

describe("the proof link a holder shares", () => {
  it("carries the secret only after the hash", async () => {
    const w = twoPartyWorld({
      holder: ALICE,
      holderViewingKey: 0x0a11ce5eecen,
      counterparty: EMPLOYER,
      counterpartyViewingKey: 0x0e11907e25ecn,
      token: USDC,
    });
    w.pool.pay(w.inbound, USDC, 4_800_000_000n);

    const session = {
      address: ALICE,
      chainId: SEPOLIA,
      pool: POOL,
      viewingKey: 0x0a11ce5eecen,
      publicKey: publicViewingKey(0x0a11ce5eecen),
    };
    const request = makeRequest({
      chainId: SEPOLIA,
      pool: POOL,
      requester: "",
      purpose: "",
      counterparty: EMPLOYER,
      token: USDC,
      nonce: "fixed",
    });
    const { disclosure } = await createDisclosure(w.pool, session, request, { now: 1 });
    const inboundKey = disclosure.keys.inbound!;
    const link = buildProofLink("https://lens.example", disclosure);

    expect(link.url.split("#")[0]).not.toContain(inboundKey.replace(/^0x/, ""));
    expect(link.path).not.toContain(inboundKey.replace(/^0x/, ""));
    // And the holder's viewing key is nowhere at all.
    expect(link.url).not.toContain((0x0a11ce5eecen).toString(16));
    // The link round trips for the verifier.
    expect(parseProofLink(link.commitment, link.fragment).disclosure).toEqual(disclosure);
  });
});
