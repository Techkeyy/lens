import { describe, expect, it } from "vitest";
import { addrSTRK as STRK } from "@/utils/constants";
import { decide } from "./decide";
import { detectHistory } from "./detect";
import { rewrite } from "./rewrite";
import { loadFixture } from "./fixture";
import { TIGHT_WINDOW_SECONDS, type PublicEdge } from "./types";

const TEN = 10n * 10n ** 18n;
const OTHER = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

function edge(p: Partial<PublicEdge> & Pick<PublicEdge, "kind" | "timestamp">): PublicEdge {
  return { token: STRK, amount: TEN, ...p };
}

describe("detectHistory", () => {
  it("flags the fixture as a loud same-amount in-out", () => {
    const findings = detectHistory(loadFixture());
    expect(findings.some((f) => f.id === "rapid-inout-same-amount")).toBe(true);
  });

  it("does not flag a pair after the window", () => {
    const findings = detectHistory(
      [edge({ kind: "shield", timestamp: 1 }), edge({ kind: "unshield", timestamp: 100_000 })],
      1800
    );
    expect(findings.some((f) => f.id === "rapid-inout-same-amount")).toBe(false);
  });

  it("flags a pair sitting exactly on the window edge", () => {
    const findings = detectHistory(
      [
        edge({ kind: "shield", timestamp: 1000 }),
        edge({ kind: "unshield", timestamp: 1000 + TIGHT_WINDOW_SECONDS }),
      ],
      TIGHT_WINDOW_SECONDS
    );
    expect(findings.some((f) => f.id === "rapid-inout-same-amount")).toBe(true);
  });

  it("does not treat a one-second-past pair as rapid", () => {
    const findings = detectHistory(
      [
        edge({ kind: "shield", timestamp: 1000 }),
        edge({ kind: "unshield", timestamp: 1000 + TIGHT_WINDOW_SECONDS + 1 }),
      ],
      TIGHT_WINDOW_SECONDS
    );
    expect(findings.some((f) => f.id === "rapid-inout-same-amount")).toBe(false);
  });

  it("does not pair a shield and unshield on different tokens", () => {
    const findings = detectHistory(
      [
        edge({ kind: "shield", timestamp: 1000 }),
        edge({ kind: "unshield", timestamp: 1060, token: OTHER }),
      ],
      1800
    );
    expect(findings.some((f) => f.id.startsWith("rapid-inout"))).toBe(false);
  });

  it("does not call a repeated amount distinctive", () => {
    const findings = detectHistory([
      edge({ kind: "shield", timestamp: 1 }),
      edge({ kind: "shield", timestamp: 2 }),
    ]);
    expect(findings.some((f) => f.id === "distinctive-amount")).toBe(false);
  });

  it("skips a zero-amount shield as distinctive", () => {
    const findings = detectHistory([edge({ kind: "shield", timestamp: 1, amount: 0n })]);
    expect(findings.some((f) => f.id === "distinctive-amount")).toBe(false);
  });

  it("reports empty history as no public edges, not as private", () => {
    const findings = detectHistory([]);
    expect(findings.map((f) => f.id)).toContain("no-public-edges");
  });
});

describe("decide + rewrite", () => {
  it("calls a matching unshield loud and offers quieter paths", () => {
    const planned = { kind: "unshield" as const, token: STRK, amount: TEN, at: 1060 };
    const score = decide([edge({ kind: "shield", timestamp: 1000 })], planned);
    expect(score.grade).toBe("loud");
    const paths = rewrite(planned, score);
    expect(paths.map((p) => p.kind)).toEqual(
      expect.arrayContaining(["wait", "split", "change-amount", "transfer-first"])
    );
  });

  it("keeps a lone private transfer quiet", () => {
    const score = decide([], { kind: "transfer", token: STRK, amount: TEN, at: 5000 });
    expect(score.grade).toBe("quiet");
  });

  it("never grades a shield as quiet", () => {
    const score = decide([], { kind: "shield", token: STRK, amount: TEN, at: 1 });
    expect(score.grade).not.toBe("quiet");
    expect(score.visible).toEqual(
      expect.arrayContaining(["Your address", "Token and amount (public Deposit event)"])
    );
  });

  it("never grades an unshield as quiet", () => {
    const score = decide([], { kind: "unshield", token: STRK, amount: TEN, at: 1 });
    expect(score.grade).not.toBe("quiet");
  });

  it("does not tell a lone unshield to wait out a window that is not there", () => {
    const planned = { kind: "unshield" as const, token: STRK, amount: TEN, at: 1 };
    const paths = rewrite(planned, decide([], planned));
    expect(paths.some((p) => p.title.includes("Wait out the tight window"))).toBe(false);
  });

  it("marks a private send next to a public door as noisy", () => {
    const score = decide([edge({ kind: "shield", timestamp: 1000 })], {
      kind: "transfer",
      token: STRK,
      amount: TEN,
      at: 1060,
    });
    expect(score.grade).toBe("noisy");
    expect(score.findings.some((f) => f.id === "planned-transfer-near-edge")).toBe(true);
  });
});
