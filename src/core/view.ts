/**
 * Presentation helpers.
 *
 * React orchestrates; it does not decide. Anything that interprets a
 * cryptographic result, a status, or a boundary lives here or deeper, so a
 * component cannot quietly invent a friendlier reading of a failure.
 *
 * Nothing in this file touches the network or a key.
 */

import { DisclosureStatus } from "./registry";
import type { DisclosureResult } from "./claim";
import type { Direction } from "./claim";
import type { Disclosure, Request } from "./bundle";

/** Tokens we can name and scale. Anything else is shown by address. */
export const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": {
    symbol: "STRK",
    decimals: 18,
  },
  "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8": {
    symbol: "USDC",
    decimals: 6,
  },
  "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": {
    symbol: "ETH",
    decimals: 18,
  },
};

export function tokenInfo(address: string): { symbol: string; decimals: number } {
  try {
    const key = "0x" + BigInt(address).toString(16);
    return KNOWN_TOKENS[key] ?? { symbol: shortAddress(address), decimals: 18 };
  } catch {
    return { symbol: "Unknown asset", decimals: 18 };
  }
}

/** `0x12a4…91f3`. Never below readable size, always copyable in the UI. */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  let hex: string;
  try {
    hex = "0x" + BigInt(address).toString(16).padStart(64, "0");
  } catch {
    return address;
  }
  return `${hex.slice(0, lead)}…${hex.slice(-tail)}`;
}

export function fullAddress(address: string): string {
  try {
    return "0x" + BigInt(address).toString(16).padStart(64, "0");
  } catch {
    return address;
  }
}

export function isAddressLike(value: string): boolean {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value.trim())) return false;
  try {
    return BigInt(value.trim()) > 0n;
  } catch {
    return false;
  }
}

export function sameAddress(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

/** Whole-unit amount with the token's decimals, grouped, no trailing noise. */
export function formatAmount(raw: bigint | string, decimals: number): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (fraction === 0n) return grouped;
  const frac = fraction.toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 2);
  return frac ? `${grouped}.${frac}` : grouped;
}

export function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return "";
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function directionLabel(d: Direction): string {
  return d === "inbound" ? "Received from them" : "Sent to them";
}

export function directionSentence(d: Direction, counterparty: string): string {
  return d === "inbound"
    ? `Payments you received from ${shortAddress(counterparty)}`
    : `Payments you sent to ${shortAddress(counterparty)}`;
}

/** The overall banner a Verifier sees. Never collapse these into one. */
export type Verdict =
  | "verified"
  | "revoked"
  | "expired"
  | "not-authorized"
  | "invalid";

export type VerdictView = {
  verdict: Verdict;
  headline: string;
  detail: string;
  tone: "ok" | "warn" | "bad";
};

/**
 * Combine the pool check and the registry status into one honest verdict.
 *
 * Order matters. A disclosure that does not match the chain is invalid whatever
 * the registry says, because the registry only ever saw a hash.
 */
export function verdictFor(
  poolResult: DisclosureResult | undefined,
  status: DisclosureStatus | undefined,
): VerdictView {
  if (!poolResult || !poolResult.verified) {
    return {
      verdict: "invalid",
      headline: "Verification failed",
      detail:
        poolResult?.reason ??
        "This disclosure does not match the data recorded on Starknet.",
      tone: "bad",
    };
  }
  switch (status) {
    case DisclosureStatus.Active:
      return {
        verdict: "verified",
        headline: "Verified disclosure",
        detail: "The holder authorized this disclosure and has not withdrawn it.",
        tone: "ok",
      };
    case DisclosureStatus.Revoked:
      return {
        verdict: "revoked",
        headline: "Authorization revoked",
        detail: "The holder withdrew authorization for this disclosure.",
        tone: "warn",
      };
    case DisclosureStatus.Expired:
      return {
        verdict: "expired",
        headline: "Authorization expired",
        detail: "The authorization period set by the holder has ended.",
        tone: "warn",
      };
    default:
      return {
        verdict: "not-authorized",
        headline: "Not authorized",
        detail:
          "The payments check out, but no holder authorization for this disclosure exists on Starknet.",
        tone: "bad",
      };
  }
}

export const STATUS_ROW_LABEL: Record<DisclosureStatus, string> = {
  [DisclosureStatus.Unknown]: "Unknown",
  [DisclosureStatus.Active]: "Active",
  [DisclosureStatus.Revoked]: "Revoked",
  [DisclosureStatus.Expired]: "Expired",
};

/**
 * Later activity, described without a number.
 *
 * The scan is bounded, so the count is a floor rather than a total. Presenting
 * it as exact would be a false precision, so the product does not present it
 * at all until the scan is exhaustive.
 */
export const LATER_ACTIVITY = {
  headline: "Later relationship activity detected",
  detail:
    "Activity exists in this relationship after the authorized snapshot. It was not part of the disclosure the holder approved, and it is not included in any total above.",
} as const;

/** A request in plain English, for the screen the Holder opens. */
export function describeRequest(request: Request): {
  title: string;
  counterparty: string;
  asset: string;
  purpose: string;
  requester: string;
} {
  return {
    title: "Disclosure request",
    counterparty: shortAddress(request.counterparty),
    asset: tokenInfo(request.token).symbol,
    purpose: request.purpose.trim(),
    requester: request.requester.trim(),
  };
}

/** What a disclosure covers, for the consent screen and the proof page. */
export function summarize(disclosure: Disclosure): {
  symbol: string;
  decimals: number;
  total: string;
  lanes: { direction: Direction; noteCount: number; total: string }[];
  noteCount: number;
} {
  const { symbol, decimals } = tokenInfo(disclosure.scope.token);
  const lanes = disclosure.directions.map((direction) => {
    const lane = disclosure.snapshot[direction];
    return {
      direction,
      noteCount: lane?.noteCount ?? 0,
      total: formatAmount(lane?.total ?? "0", decimals),
    };
  });
  return {
    symbol,
    decimals,
    total: formatAmount(disclosure.assertedTotal, decimals),
    lanes,
    noteCount: lanes.reduce((n, l) => n + l.noteCount, 0),
  };
}
