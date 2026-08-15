import { decide } from "@/core/decide";
import type { PlannedKind, Score } from "@/core/types";

const KIND: Record<string, PlannedKind> = {
  shield: "shield",
  unshield: "unshield",
  transfer: "transfer",
  send: "transfer",
  list: "shield",
  bid: "transfer",
  reveal: "transfer",
  settle: "transfer",
  claim: "unshield",
};

export default function LeakSheet({ score, kind }: { score?: Score; kind?: string }) {
  const resolved =
    score ??
    decide([], { kind: KIND[kind ?? "transfer"] ?? "transfer", token: "0x1", amount: 1n });
  return (
    <div className="leak">
      <p className="kicker">What this action reveals</p>
      <div className="leak-cols">
        <div>
          <h4>Hidden</h4>
          <ul>
            {resolved.hidden.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Visible on-chain</h4>
          <ul>
            {resolved.visible.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
