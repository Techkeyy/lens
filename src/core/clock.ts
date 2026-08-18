import { describeGap } from "./detect";
import { TIGHT_WINDOW_SECONDS, type PlannedAction, type PublicEdge } from "./types";

/** Unix seconds after which this click is no longer inside the official tight window. */
export function quietAfter(
  history: PublicEdge[],
  planned: PlannedAction,
  windowSeconds = TIGHT_WINDOW_SECONDS
): number | undefined {
  const at = planned.at ?? Math.floor(Date.now() / 1000);
  const token = planned.token.toLowerCase();

  if (planned.kind === "unshield") {
    const shields = history.filter((e) => e.kind === "shield" && e.token.toLowerCase() === token);
    const twins = shields.filter((e) => e.amount === planned.amount && planned.amount !== 0n);
    const inWindow = (e: PublicEdge) => at - e.timestamp >= 0 && at - e.timestamp <= windowSeconds;
    const source = twins.some(inWindow) ? twins.filter(inWindow) : shields.filter(inWindow);
    if (!source.length) return undefined;
    return Math.max(...source.map((e) => e.timestamp)) + windowSeconds;
  }

  if (planned.kind === "transfer") {
    const doors = history.filter(
      (e) => (e.kind === "shield" || e.kind === "unshield") && Math.abs(at - e.timestamp) <= windowSeconds
    );
    if (!doors.length) return undefined;
    return Math.max(...doors.map((e) => e.timestamp)) + windowSeconds;
  }

  return undefined;
}

export function formatUtc(ts: number): string {
  return `${new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export function waitLabel(quietAt: number, now: number): string {
  const remain = Math.max(0, quietAt - now);
  return `Wait ${describeGap(remain)} (quiet after ${formatUtc(quietAt)})`;
}
