import { num } from "starknet";

export function fmtToken(amount: bigint, decimals = 18, maxFrac = 4): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (!frac) return whole.toString();
  return `${whole}.${frac.slice(0, maxFrac)}`;
}

export function parseToken(input: string, decimals = 18): bigint {
  const t = input.trim();
  if (!t) return 0n;
  const [w, f = ""] = t.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export function shortHex(h: string): string {
  const hex = num.toHex(h);
  return hex.length <= 13 ? hex : `${hex.slice(0, 7)}…${hex.slice(-4)}`;
}

export function explorerTx(networkIndex: number, hash: string): string {
  return networkIndex === 0
    ? `https://voyager.online/tx/${hash}`
    : `https://sepolia.voyager.online/tx/${hash}`;
}

export function explorerContract(networkIndex: number, addr: string): string {
  return networkIndex === 0
    ? `https://voyager.online/contract/${addr}`
    : `https://sepolia.voyager.online/contract/${addr}`;
}

export function prettyStatus(finality?: string, exec?: string): string {
  const f =
    finality === "ACCEPTED_ON_L2"
      ? "Accepted on L2"
      : finality === "ACCEPTED_ON_L1"
        ? "Accepted on L1"
        : finality === "RECEIVED"
          ? "Received"
          : (finality ?? "");
  const e = exec === "SUCCEEDED" ? "Succeeded" : exec === "REVERTED" ? "Reverted" : "";
  return [f, e].filter(Boolean).join(" · ") || "Confirmed";
}

export function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return "ended";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function phaseOf(now: number, bidEnd: number, revealEnd: number, settled: boolean) {
  if (settled) return "settled" as const;
  if (now < bidEnd) return "bidding" as const;
  if (now < revealEnd) return "reveal" as const;
  return "settle" as const;
}

export type Phase = ReturnType<typeof phaseOf>;
