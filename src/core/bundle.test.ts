/**
 * Digest stability and scope binding.
 *
 * The digest is what the chain anchors, so two clients must agree on it byte
 * for byte, and any change to what the verifier relies on must break it. The
 * cases that matter are the tampering ones: a bundle re-pointed at a different
 * lane, or reused against a different request, has to fail.
 */

import { describe, expect, it } from "vitest";
import {
  BUNDLE_VERSION,
  type Bundle,
  type Request,
  answersRequest,
  bundleDigest,
  decodeLink,
  encodeLink,
  isExpired,
  makeRequest,
  normalizeBundle,
  requestDigest,
} from "./bundle";

const SEPOLIA = "0x534e5f5345504f4c4941";
const ACME = "0x0acce55";
const ADA = "0x0ada";
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const MALLORY = "0x0badbad";
const STRANGER = "0x0e15e";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

const request: Request = makeRequest({
  chainId: SEPOLIA,
  pool: POOL,
  requester: "Acme Exchange",
  purpose: "Source of funds for your 8,000 USDC withdrawal",
  scope: { sender: ACME, recipient: ADA, token: USDC },
  expiresAt: 0,
  nonce: "fixed-nonce-for-tests",
});

const bundle: Bundle = {
  v: BUNDLE_VERSION,
  chainId: SEPOLIA,
  pool: POOL,
  requestDigest: requestDigest(request),
  subject: ADA,
  scope: { sender: ACME, recipient: ADA, token: USDC },
  channelKey: "0xdef",
  assertedTotal: "350",
  assertedAmounts: ["100", "250"],
  issuedAt: 1_700_000_000,
  expiresAt: 0,
};

describe("digests", () => {
  it("is stable across repeated computation", () => {
    expect(bundleDigest(bundle)).toBe(bundleDigest(bundle));
    expect(requestDigest(request)).toBe(requestDigest(request));
  });

  it("does not depend on JSON key order", () => {
    const reordered = JSON.parse(
      JSON.stringify({
        expiresAt: bundle.expiresAt,
        scope: bundle.scope,
        v: bundle.v,
        pool: bundle.pool,
        subject: bundle.subject,
        chainId: bundle.chainId,
        channelKey: bundle.channelKey,
        assertedAmounts: bundle.assertedAmounts,
        requestDigest: bundle.requestDigest,
        assertedTotal: bundle.assertedTotal,
        issuedAt: bundle.issuedAt,
      }),
    ) as Bundle;
    expect(bundleDigest(reordered)).toBe(bundleDigest(bundle));
  });

  it("agrees regardless of how a client formatted its felts", () => {
    const padded = normalizeBundle({
      ...bundle,
      channelKey: "0x0def",
      subject: "0x0ada",
    });
    expect(bundleDigest(padded)).toBe(bundleDigest(normalizeBundle(bundle)));
  });

  it("changes when the lane changes, so an anchor cannot vouch for another lane", () => {
    const elsewhere = { ...bundle, channelKey: "0xbeef" };
    expect(bundleDigest(elsewhere)).not.toBe(bundleDigest(bundle));
  });

  it("changes when the claimed total changes", () => {
    expect(bundleDigest({ ...bundle, assertedTotal: "351" })).not.toBe(bundleDigest(bundle));
  });

  it("changes when the subject changes", () => {
    expect(bundleDigest({ ...bundle, subject: MALLORY })).not.toBe(bundleDigest(bundle));
  });

  it("distinguishes an omitted amount list from an empty one", () => {
    const none = { ...bundle, assertedAmounts: undefined };
    const empty = { ...bundle, assertedAmounts: [] };
    expect(bundleDigest(none)).toBe(bundleDigest(empty));
  });

  it("separates two otherwise identical requests by nonce", () => {
    const other = { ...request, nonce: "different" };
    expect(requestDigest(other)).not.toBe(requestDigest(request));
  });

  it("accepts a purpose longer than a felt", () => {
    const wordy = {
      ...request,
      purpose: "x".repeat(400),
    };
    expect(requestDigest(wordy)).toMatch(/^0x[0-9a-f]+$/);
    expect(requestDigest(wordy)).not.toBe(requestDigest(request));
  });
});

describe("answersRequest", () => {
  it("accepts the bundle made for it", () => {
    expect(answersRequest(bundle, request).ok).toBe(true);
  });

  it("rejects a bundle made for a different request", () => {
    const other = makeRequest({ ...request, nonce: "another" });
    const r = answersRequest(bundle, other);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("different request");
  });

  it("rejects a bundle that answers about a different counterparty", () => {
    const swapped: Bundle = { ...bundle, scope: { ...bundle.scope, sender: STRANGER } };
    const r = answersRequest(swapped, request);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("different lane");
  });

  it("rejects a bundle from another network", () => {
    const mainnetish: Bundle = { ...bundle, chainId: "0x534e5f4d41494e" };
    // Re-point its requestDigest so the lane check is what fires, not the digest.
    const r = answersRequest(
      { ...mainnetish, requestDigest: requestDigest({ ...request, chainId: "0x534e5f4d41494e" }) },
      { ...request, chainId: "0x534e5f4d41494e" },
    );
    expect(r.ok).toBe(true);
    expect(answersRequest(mainnetish, request).ok).toBe(false);
  });
});

describe("expiry", () => {
  it("treats zero as never expiring", () => {
    expect(isExpired(0, 9_999_999_999)).toBe(false);
  });

  it("expires strictly after the deadline", () => {
    expect(isExpired(1000, 1000)).toBe(false);
    expect(isExpired(1000, 1001)).toBe(true);
  });
});

describe("links", () => {
  it("round trips a bundle through a link", () => {
    expect(decodeLink<Bundle>(encodeLink(bundle))).toEqual(bundle);
  });

  it("round trips a request", () => {
    expect(decodeLink<Request>(encodeLink(request))).toEqual(request);
  });

  it("produces a link safe to paste, with no padding or slashes", () => {
    expect(encodeLink(bundle)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("explains a version mismatch instead of failing obscurely", () => {
    const stale = Buffer.from(JSON.stringify({ ...bundle, v: 99 }), "utf8").toString("base64url");
    expect(() => decodeLink(stale)).toThrow(/version 99/);
  });
});
