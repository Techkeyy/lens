import { SOURCES, TIGHT_WINDOW_SECONDS, type Finding, type PublicEdge } from "./types";

function sameToken(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function detectHistory(edges: PublicEdge[], windowSeconds = TIGHT_WINDOW_SECONDS): Finding[] {
  const sorted = [...edges].sort((a, b) => a.timestamp - b.timestamp);
  const findings: Finding[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (a.kind !== "shield") continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.kind !== "unshield") continue;
      if (!sameToken(a.token, b.token)) continue;
      const dt = b.timestamp - a.timestamp;
      if (dt < 0 || dt > windowSeconds) continue;
      if (a.amount === b.amount) {
        findings.push({
          id: "rapid-inout-same-amount",
          severity: "loud",
          title: "Same amount in, then out, quickly",
          detail: `${formatAmt(a.amount)} went into the pool and the same amount came back out ${describeGap(dt)} later. Official docs call this a rapid in-and-out.`,
          source: SOURCES.distinctive,
        });
      } else {
        findings.push({
          id: "rapid-inout",
          severity: "noisy",
          title: "In and out in a tight window",
          detail: `A shield and an unshield on the same token sat ${describeGap(dt)} apart. Amounts differ, but tight succession is still a documented leak.`,
          source: SOURCES.succession,
        });
      }
    }
  }

  const shields = sorted.filter((e) => e.kind === "shield");
  const byAmount = new Map<string, number>();
  for (const e of shields) {
    const k = `${e.token.toLowerCase()}:${e.amount.toString()}`;
    byAmount.set(k, (byAmount.get(k) ?? 0) + 1);
  }
  for (const e of shields) {
    const k = `${e.token.toLowerCase()}:${e.amount.toString()}`;
    if ((byAmount.get(k) ?? 0) === 1 && e.amount !== 0n) {
      findings.push({
        id: "distinctive-amount",
        severity: "noisy",
        title: "A recognizable deposit amount",
        detail: `${formatAmt(e.amount)} appears once as a public shield. Unshielding the same figure later is the pattern the docs warn about.`,
        source: SOURCES.distinctive,
      });
    }
  }

  if (sorted.length === 0) {
    findings.push({
      id: "no-public-edges",
      severity: "info",
      title: "No public pool edges on this address",
      detail:
        "We only read Deposit and Withdrawal events. Private transfers do not appear. Empty is not private forever — the next shield or unshield will be public.",
      source: SOURCES.edges,
    });
  }

  return dedupe(findings);
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const k = f.id + f.detail;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function formatAmt(amount: bigint, decimals = 18): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac.slice(0, 6)}` : whole.toString();
}

export function describeGap(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}
