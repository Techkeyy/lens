import { detectHistory, formatAmt } from "./detect";
import {
  SOURCES,
  TIGHT_WINDOW_SECONDS,
  type Finding,
  type Grade,
  type PlannedAction,
  type PublicEdge,
  type Score,
} from "./types";

export function visibilityFor(kind: PlannedAction["kind"]): { hidden: string[]; visible: string[] } {
  if (kind === "shield") {
    return {
      hidden: ["What you do with the notes after they enter the pool"],
      visible: ["Your address", "Token and amount (public Deposit event)", "Time you used the pool"],
    };
  }
  if (kind === "unshield") {
    return {
      hidden: ["Which notes funded the withdrawal"],
      visible: ["Recipient address", "Token and amount (public Withdrawal event)", "Time you used the pool"],
    };
  }
  return {
    hidden: ["Who paid whom", "The amount", "Which token", "Which notes moved"],
    visible: ["That someone used the pool", "Timing of that interaction"],
  };
}

export function decide(
  history: PublicEdge[],
  planned: PlannedAction,
  windowSeconds = TIGHT_WINDOW_SECONDS
): Score {
  const at = planned.at ?? Math.floor(Date.now() / 1000);
  const findings: Finding[] = [...detectHistory(history, windowSeconds)];
  const vis = visibilityFor(planned.kind);

  if (planned.kind === "unshield") {
    findings.unshift({
      id: "planned-public-withdrawal",
      severity: "info",
      title: "This unshield is a public edge",
      detail: `Withdrawing ${formatAmt(planned.amount)} publishes the recipient, token, and amount. Which notes funded it stays hidden.`,
      source: SOURCES.edges,
    });
    const twins = history.filter(
      (e) =>
        e.kind === "shield" &&
        e.token.toLowerCase() === planned.token.toLowerCase() &&
        e.amount === planned.amount &&
        at - e.timestamp >= 0 &&
        at - e.timestamp <= windowSeconds
    );
    if (twins.length) {
      findings.unshift({
        id: "planned-rapid-inout-same-amount",
        severity: "loud",
        title: "This cash-out matches a recent deposit",
        detail: `You are about to take out ${formatAmt(planned.amount)}, the same public amount that went in ${ago(twins[0].timestamp, at)} ago.`,
        source: SOURCES.distinctive,
      });
    } else if (
      history.some(
        (e) =>
          e.kind === "shield" &&
          e.token.toLowerCase() === planned.token.toLowerCase() &&
          at - e.timestamp >= 0 &&
          at - e.timestamp <= windowSeconds
      )
    ) {
      findings.unshift({
        id: "planned-tight-succession",
        severity: "noisy",
        title: "Unshield soon after a shield",
        detail: `A deposit on this token is still inside the ${Math.round(windowSeconds / 60)}-minute window.`,
        source: SOURCES.succession,
      });
    }
  }

  if (planned.kind === "shield") {
    findings.unshift({
      id: "planned-public-deposit",
      severity: "info",
      title: "This shield is a public edge",
      detail: `Depositing ${formatAmt(planned.amount)} publishes your address, token, and amount. The note inside is encrypted; this door is not.`,
      source: SOURCES.edges,
    });
  }

  if (planned.kind === "transfer") {
    findings.unshift({
      id: "planned-private-transfer",
      severity: "quiet",
      title: "Inside the pool, the payment itself stays hidden",
      detail: "Sender, receiver, amount, and token are private. A watcher still sees that the pool was used, and when.",
      source: SOURCES.inside,
    });
    if (
      history.some(
        (e) => (e.kind === "shield" || e.kind === "unshield") && Math.abs(at - e.timestamp) <= windowSeconds
      )
    ) {
      findings.unshift({
        id: "planned-transfer-near-edge",
        severity: "noisy",
        title: "A private send next to a public door",
        detail: "You have a public shield or unshield in the same window. Timing can glue them. Spread setup and movement.",
        source: SOURCES.succession,
      });
    }
  }

  return { grade: gradeOf(findings, planned.kind), findings, hidden: vis.hidden, visible: vis.visible };
}

function gradeOf(findings: Finding[], kind: PlannedAction["kind"]): Grade {
  if (findings.some((f) => f.severity === "loud")) return "loud";
  if (findings.some((f) => f.severity === "noisy")) return "noisy";
  // Public doors are never quiet, even with no extra leak pattern.
  if (kind === "shield" || kind === "unshield") return "noisy";
  return "quiet";
}

function ago(then: number, now: number): string {
  const s = Math.max(0, now - then);
  if (s < 60) return `${s} seconds`;
  if (s < 3600) return `${Math.round(s / 60)} minutes`;
  return `${Math.round(s / 3600)} hours`;
}
