import { formatAmt } from "./detect";
import { TIGHT_WINDOW_SECONDS, type PlannedAction, type Rewrite, type Score } from "./types";

export function rewrite(
  planned: PlannedAction,
  score: Score,
  windowSeconds = TIGHT_WINDOW_SECONDS
): Rewrite[] {
  const out: Rewrite[] = [];

  if (score.grade === "quiet" && planned.kind === "transfer") {
    return [
      {
        kind: "wait",
        title: "This path is already the quiet one",
        detail: "A private transfer hides who paid whom. No rewrite unless a public door sits next to it.",
      },
    ];
  }

  if (planned.kind === "unshield" && score.findings.some((f) => f.id === "planned-rapid-inout-same-amount")) {
    out.push({
      kind: "wait",
      title: `Wait at least ${Math.round(windowSeconds / 60)} minutes`,
      detail: "Spread deposit and withdrawal over time. Same amount later is still a pattern; the tight clock is the loud part.",
      waitSeconds: windowSeconds,
    });
    const changed = (planned.amount * 7n) / 10n;
    if (changed > 0n && changed !== planned.amount) {
      out.push({
        kind: "change-amount",
        title: `Take out a different amount (${formatAmt(changed)})`,
        detail: "Breaking the matching figure stops the obvious pair. The withdrawal itself stays public.",
        action: { ...planned, amount: changed },
      });
    }
    const half = planned.amount / 2n;
    if (half > 0n) {
      out.push({
        kind: "split",
        title: `Split: take ${formatAmt(half)} now, the rest later`,
        detail: "Two smaller public legs are less of a fingerprint than one perfect echo of the deposit.",
        action: { ...planned, amount: half },
      });
    }
    out.push({
      kind: "transfer-first",
      title: "Move privately first, cash out later",
      detail: "An in-pool transfer does not publish amount or counterparties. Unshielding immediately after still has a timing cost.",
      action: { kind: "transfer", token: planned.token, amount: planned.amount },
    });
  } else if (planned.kind === "unshield" && score.grade !== "quiet") {
    out.push({
      kind: "wait",
      title: "Wait out the tight window",
      detail: "You have a recent public shield on this token.",
      waitSeconds: windowSeconds,
    });
  }

  if (planned.kind === "shield") {
    out.push({
      kind: "wait",
      title: "Shield is always a public door",
      detail: "There is no quiet shield. After this, stay inside the pool if you can.",
    });
  }

  if (planned.kind === "transfer" && score.findings.some((f) => f.id === "planned-transfer-near-edge")) {
    out.push({
      kind: "wait",
      title: "Wait before the private send",
      detail: "Do not sit a private transfer on top of a public shield or unshield.",
      waitSeconds: windowSeconds,
    });
  }

  if (!out.length) {
    out.push({
      kind: "wait",
      title: "No rewrite required",
      detail: "Nothing in the official leak list fires on this action as planned.",
    });
  }

  return out;
}
