/**
 * Where the secret is allowed to appear.
 *
 * A disclosure carries reusable channel keys. The URL fragment is the only part
 * of a link a browser does not transmit, so the whole design rests on the keys
 * living there and nowhere else. These tests are what stop a future refactor
 * from quietly moving them into the path or a query string.
 */

import { describe, expect, it } from "vitest";
import {
  PROOF_ROUTE_HEADERS,
  ProofLinkError,
  buildProofLink,
  commitmentFromPath,
  fromDisclosureFile,
  parseProofLink,
  toDisclosureFile,
} from "./transport";
import { DISCLOSURE_SCHEME, type Disclosure, disclosureCommitment, encodeLink } from "./bundle";

const CHANNEL_KEY_IN = "0x7c0ffee1234567890abcdef1234567890abcdef1234567890abcdef123456789";
const CHANNEL_KEY_OUT = "0x5deadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567";
const VIEWING_KEY = "0x3141592653589793238462643383279502884197169399375105820974944592";

const disclosure: Disclosure = {
  scheme: DISCLOSURE_SCHEME,
  chainId: "0x534e5f5345504f4c4941",
  pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  requestCommitment: "0x0",
  scope: {
    holder: "0x0a11ce",
    counterparty: "0x0e11907e2",
    token: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  },
  directions: ["outbound", "inbound"],
  keys: { outbound: CHANNEL_KEY_OUT, inbound: CHANNEL_KEY_IN },
  snapshot: { outbound: { noteCount: 1, total: "50" }, inbound: { noteCount: 2, total: "300" } },
  assertedTotal: "350",
  createdAt: 1_724_000_000,
};

const strip0x = (v: string) => v.replace(/^0x/, "");

describe("proof link structure", () => {
  const link = buildProofLink("https://lens.example", disclosure);

  it("puts only the commitment in the path", () => {
    expect(link.path).toBe(`/proof/${disclosureCommitment(disclosure)}`);
  });

  it("keeps every channel key out of the path", () => {
    for (const key of [CHANNEL_KEY_IN, CHANNEL_KEY_OUT]) {
      expect(link.path).not.toContain(key);
      expect(link.path).not.toContain(strip0x(key));
    }
  });

  it("keeps every channel key out of everything before the #", () => {
    const beforeFragment = link.url.split("#")[0];
    for (const key of [CHANNEL_KEY_IN, CHANNEL_KEY_OUT]) {
      expect(beforeFragment).not.toContain(key);
      expect(beforeFragment).not.toContain(strip0x(key));
    }
    // And the decoded fragment is where they actually are.
    const decoded = Buffer.from(link.fragment, "base64url").toString("utf8");
    expect(decoded).toContain(CHANNEL_KEY_IN);
  });

  it("uses no query string at all, so nothing can drift into one", () => {
    expect(link.url.split("#")[0]).not.toContain("?");
  });

  it("never carries the master viewing key anywhere", () => {
    expect(link.url).not.toContain(VIEWING_KEY);
    expect(link.url).not.toContain(strip0x(VIEWING_KEY));
    expect(Buffer.from(link.fragment, "base64url").toString("utf8")).not.toContain(VIEWING_KEY);
  });

  it("builds a relative link when no origin is given", () => {
    expect(buildProofLink("", disclosure).url.startsWith("/proof/0x")).toBe(true);
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(buildProofLink("https://lens.example/", disclosure).url).not.toContain(".example//");
  });
});

describe("reading a proof link", () => {
  const link = buildProofLink("", disclosure);

  it("round trips", () => {
    const out = parseProofLink(link.commitment, link.fragment);
    expect(out.disclosure).toEqual(disclosure);
    expect(out.commitment).toBe(link.commitment);
  });

  it("accepts a fragment that still has its leading hash", () => {
    expect(parseProofLink(link.commitment, `#${link.fragment}`).commitment).toBe(link.commitment);
  });

  it("refuses when the path commitment does not match the disclosure", () => {
    expect(() => parseProofLink("0xdeadbeef", link.fragment)).toThrow(ProofLinkError);
    expect(() => parseProofLink("0xdeadbeef", link.fragment)).toThrow(/does not match/);
  });

  it("refuses an edited fragment", () => {
    const tampered = encodeLink({ ...disclosure, assertedTotal: "999999" });
    expect(() => parseProofLink(link.commitment, tampered)).toThrow(/does not match/);
  });

  it("explains a missing fragment rather than showing an empty page", () => {
    expect(() => parseProofLink(link.commitment, "")).toThrow(/missing its disclosure/);
  });

  it("rejects a malformed fragment", () => {
    expect(() => parseProofLink(link.commitment, "!!!not-base64url!!!")).toThrow(ProofLinkError);
  });

  it("rejects a v1 disclosure instead of reinterpreting it", () => {
    const v1 = encodeLink({ ...disclosure, scheme: "lens-disclosure-v1" } as never);
    expect(() => parseProofLink(link.commitment, v1)).toThrow(/refused rather than guessed/);
  });

  it("rejects a v2 disclosure with no snapshot", () => {
    const noSnapshot = encodeLink({ ...disclosure, snapshot: undefined } as never);
    expect(() => parseProofLink(link.commitment, noSnapshot)).toThrow(/no snapshot boundary/);
  });
});

describe("path parsing", () => {
  it("extracts the commitment", () => {
    expect(commitmentFromPath("/proof/0xabc123")).toBe("0xabc123");
  });

  it("tolerates a trailing slash", () => {
    expect(commitmentFromPath("/proof/0xabc123/")).toBe("0xabc123");
  });

  it("returns nothing for another route", () => {
    expect(commitmentFromPath("/disclosures")).toBeUndefined();
  });
});

describe("file transport", () => {
  it("round trips without a URL, so nothing lands in browser history", () => {
    const file = toDisclosureFile(disclosure);
    expect(file.filename).toMatch(/^lens-disclosure-0x[0-9a-f]+\.lens\.json$/);
    expect(fromDisclosureFile(file.body)).toEqual(disclosure);
  });

  it("rejects a file that is not a disclosure", () => {
    expect(() => fromDisclosureFile("{}")).toThrow();
    expect(() => fromDisclosureFile("not json")).toThrow(/not a Lens disclosure/);
  });
});

describe("route headers", () => {
  it("sends no referrer, so the URL cannot leak to a site clicked through to", () => {
    expect(PROOF_ROUTE_HEADERS["Referrer-Policy"]).toBe("no-referrer");
  });

  it("keeps the proof page out of shared caches", () => {
    expect(PROOF_ROUTE_HEADERS["Cache-Control"]).toContain("no-store");
  });
});
