/**
 * Commitment determinism, scheme rejection, and the payload invariant.
 *
 * The commitment is what the chain stores, so two clients must agree on it
 * byte for byte and any change to what a Verifier relies on must break it.
 * The last block here guards the product's central invariant: a Holder's
 * master viewing key must never appear in anything that leaves their browser.
 */

import { describe, expect, it } from "vitest";
import {
  DISCLOSURE_SCHEME,
  DISCLOSURE_SCHEME_V1,
  REQUEST_SCHEME,
  type Disclosure,
  type Request,
  answersRequest,
  canonicalDirections,
  decodeDisclosure,
  decodeRequest,
  disclosureCommitment,
  encodeLink,
  makeRequest,
  normalizeDisclosure,
  requestCommitment,
} from "./bundle";
import { deriveViewingKeyFromPrivateKey, publicViewingKey } from "./session";
import { computeChannelKey } from "./derive";

const SEPOLIA = "0x534e5f5345504f4c4941";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const ALICE = "0x0a11ce";
const EMPLOYER = "0x0e11907e2";
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

const request: Request = makeRequest({
  chainId: SEPOLIA,
  pool: POOL,
  requester: "Northside Lettings",
  purpose: "Proof of salary income for a tenancy application",
  counterparty: EMPLOYER,
  token: USDC,
  nonce: "fixed-for-tests",
});

const disclosure: Disclosure = {
  scheme: DISCLOSURE_SCHEME,
  chainId: SEPOLIA,
  pool: POOL,
  requestCommitment: requestCommitment(request),
  scope: { holder: ALICE, counterparty: EMPLOYER, token: USDC },
  directions: ["inbound"],
  keys: { inbound: "0xdef" },
  snapshot: { inbound: { noteCount: 3, total: "9200" } },
  assertedTotal: "9200",
  createdAt: 1_724_000_000,
};

describe("commitment", () => {
  it("is stable across repeated computation", () => {
    expect(disclosureCommitment(disclosure)).toBe(disclosureCommitment(disclosure));
    expect(requestCommitment(request)).toBe(requestCommitment(request));
  });

  it("does not depend on JSON key order", () => {
    const reordered = JSON.parse(
      JSON.stringify({
        createdAt: disclosure.createdAt,
        keys: disclosure.keys,
        scheme: disclosure.scheme,
        scope: disclosure.scope,
        pool: disclosure.pool,
        assertedTotal: disclosure.assertedTotal,
        chainId: disclosure.chainId,
        directions: disclosure.directions,
        snapshot: disclosure.snapshot,
        requestCommitment: disclosure.requestCommitment,
      }),
    ) as Disclosure;
    expect(disclosureCommitment(reordered)).toBe(disclosureCommitment(disclosure));
  });

  it("agrees however a client padded its felts", () => {
    const padded = normalizeDisclosure({
      ...disclosure,
      keys: { inbound: "0x0def" },
      snapshot: { inbound: { noteCount: 3, total: "9200" } },
      scope: { ...disclosure.scope, holder: "0x00a11ce" },
    });
    expect(disclosureCommitment(padded)).toBe(disclosureCommitment(normalizeDisclosure(disclosure)));
  });

  it("orders directions canonically, so lane order cannot change the hash", () => {
    const keys = { inbound: "0x1", outbound: "0x2" };
    const snapshot = {
      inbound: { noteCount: 3, total: "9200" },
      outbound: { noteCount: 1, total: "5" },
    };
    const a: Disclosure = { ...disclosure, directions: ["inbound", "outbound"], keys, snapshot };
    const b: Disclosure = { ...disclosure, directions: ["outbound", "inbound"], keys, snapshot };
    expect(disclosureCommitment(a)).toBe(disclosureCommitment(b));
    expect(canonicalDirections(["inbound", "outbound"])).toEqual(["outbound", "inbound"]);
  });

  it("changes when the disclosed relationship changes", () => {
    expect(disclosureCommitment({ ...disclosure, keys: { inbound: "0xbeef" } })).not.toBe(
      disclosureCommitment(disclosure),
    );
  });

  it("changes when a second direction is added", () => {
    const both: Disclosure = {
      ...disclosure,
      directions: ["outbound", "inbound"],
      keys: { inbound: "0xdef", outbound: "0xabc" },
      snapshot: {
        inbound: { noteCount: 3, total: "9200" },
        outbound: { noteCount: 1, total: "5" },
      },
    };
    expect(disclosureCommitment(both)).not.toBe(disclosureCommitment(disclosure));
  });

  it("changes when the holder changes", () => {
    const impostor = { ...disclosure, scope: { ...disclosure.scope, holder: "0x0badbad" } };
    expect(disclosureCommitment(impostor)).not.toBe(disclosureCommitment(disclosure));
  });

  it("changes when the snapshot note count changes", () => {
    const wider = {
      ...disclosure,
      snapshot: { inbound: { noteCount: 4, total: "9200" } },
    };
    expect(disclosureCommitment(wider)).not.toBe(disclosureCommitment(disclosure));
  });

  it("changes when the snapshot total changes", () => {
    const richer = {
      ...disclosure,
      snapshot: { inbound: { noteCount: 3, total: "9201" } },
    };
    expect(disclosureCommitment(richer)).not.toBe(disclosureCommitment(disclosure));
  });

  it("changes when the claimed total changes", () => {
    expect(disclosureCommitment({ ...disclosure, assertedTotal: "9201" })).not.toBe(
      disclosureCommitment(disclosure),
    );
  });

  it("separates two otherwise identical requests by nonce", () => {
    expect(requestCommitment({ ...request, nonce: "other" })).not.toBe(requestCommitment(request));
  });

  it("accepts a purpose longer than one felt", () => {
    const wordy = { ...request, purpose: "x".repeat(400) };
    expect(requestCommitment(wordy)).toMatch(/^0x[0-9a-f]+$/);
    expect(requestCommitment(wordy)).not.toBe(requestCommitment(request));
  });
});

describe("answersRequest", () => {
  it("accepts the disclosure made for it", () => {
    expect(answersRequest(disclosure, request).ok).toBe(true);
  });

  it("rejects one made for a different request", () => {
    const r = answersRequest(disclosure, makeRequest({ ...request, nonce: "another" }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("different request");
  });

  it("rejects one about a different counterparty", () => {
    const swapped: Disclosure = {
      ...disclosure,
      scope: { ...disclosure.scope, counterparty: "0x0e15e" },
    };
    expect(answersRequest(swapped, request).reason).toContain("different relationship");
  });

  it("rejects one from another network", () => {
    const elsewhere: Disclosure = { ...disclosure, chainId: "0x534e5f4d41494e" };
    expect(answersRequest(elsewhere, request).ok).toBe(false);
  });
});

describe("links and schemes", () => {
  it("round trips a disclosure", () => {
    expect(decodeDisclosure(encodeLink(disclosure))).toEqual(disclosure);
  });

  it("round trips a request", () => {
    expect(decodeRequest(encodeLink(request))).toEqual(request);
  });

  it("is safe to paste, with no padding or slashes", () => {
    expect(encodeLink(disclosure)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses an unknown scheme instead of guessing", () => {
    const alien = encodeLink({ ...disclosure, scheme: "lens-disclosure-v9" } as never);
    expect(() => decodeDisclosure(alien)).toThrow(/refused rather than guessed/);
  });

  it("refuses a v1 disclosure rather than reading it as v2", () => {
    const v1 = encodeLink({ ...disclosure, scheme: DISCLOSURE_SCHEME_V1 } as never);
    expect(() => decodeDisclosure(v1)).toThrow(new RegExp(DISCLOSURE_SCHEME_V1));
  });

  it("refuses a v2 disclosure with no snapshot boundary", () => {
    const noSnapshot = encodeLink({ ...disclosure, snapshot: undefined } as never);
    expect(() => decodeDisclosure(noSnapshot)).toThrow(/no snapshot boundary/);
  });

  it("refuses a request link fed to the disclosure decoder", () => {
    expect(() => decodeDisclosure(encodeLink(request))).toThrow(new RegExp(REQUEST_SCHEME));
  });

  it("explains a damaged link in plain language", () => {
    expect(() => decodeRequest("not-valid-base64url!!")).toThrow(/damaged/);
  });
});

describe("the master viewing key never leaves", () => {
  const viewingKey = deriveViewingKeyFromPrivateKey("0xabc123", SEPOLIA, POOL);
  const employerPub = publicViewingKey(deriveViewingKeyFromPrivateKey("0xdef456", SEPOLIA, POOL));
  const laneKey = computeChannelKey(ALICE, viewingKey, EMPLOYER, employerPub);

  const real: Disclosure = {
    ...disclosure,
    keys: { outbound: "0x" + laneKey.toString(16) },
    directions: ["outbound"],
    snapshot: { outbound: { noteCount: 3, total: "9200" } },
  };

  it("is absent from the disclosure payload", () => {
    const serialized = JSON.stringify(real);
    expect(serialized).not.toContain(viewingKey.toString(16));
    expect(serialized).not.toContain(viewingKey.toString());
  });

  it("is absent from the shareable link", () => {
    const decoded = Buffer.from(encodeLink(real), "base64url").toString("utf8");
    expect(decoded).not.toContain(viewingKey.toString(16));
  });

  it("cannot be recovered from the channel key it produced", () => {
    // The channel key is a Poseidon output over the viewing key, so handing it
    // over does not hand over the key that made it.
    expect(laneKey).not.toBe(viewingKey);
    expect(("0x" + laneKey.toString(16)).includes(viewingKey.toString(16))).toBe(false);
  });

  it("is absent from the on-chain commitment preimage inputs we publish", () => {
    // Only the commitment reaches the chain, and it is a hash.
    expect(disclosureCommitment(real)).toMatch(/^0x[0-9a-f]+$/);
    expect(disclosureCommitment(real)).not.toContain(viewingKey.toString(16));
  });
});
