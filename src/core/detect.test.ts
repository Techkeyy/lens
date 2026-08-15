import { describe, expect, it } from "vitest";
import { addrSTRK as STRK } from "@/utils/constants";
import { decide } from "./decide";
import { detectHistory } from "./detect";
import { rewrite } from "./rewrite";
import { loadFixture } from "./fixture";
import type { PublicEdge } from "./types";

const TEN = 10n * 10n ** 18n;

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
});
