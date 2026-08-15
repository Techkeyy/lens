export type EdgeKind = "shield" | "unshield";

export type PublicEdge = {
  kind: EdgeKind;
  token: string;
  amount: bigint;
  timestamp: number;
  txHash?: string;
};

export type PlannedKind = "shield" | "unshield" | "transfer";

export type PlannedAction = {
  kind: PlannedKind;
  token: string;
  amount: bigint;
  at?: number;
};

export type Severity = "loud" | "noisy" | "quiet" | "info";

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  source: string;
};

export type Grade = "quiet" | "noisy" | "loud";

export type Score = {
  grade: Grade;
  findings: Finding[];
  hidden: string[];
  visible: string[];
};

export type RewriteKind = "wait" | "split" | "change-amount" | "transfer-first";

export type Rewrite = {
  kind: RewriteKind;
  title: string;
  detail: string;
  action?: PlannedAction;
  waitSeconds?: number;
};

export const TIGHT_WINDOW_SECONDS = 30 * 60;

export const SOURCES = {
  edges:
    "https://strk20-by-example.org/compliance. Edges are public by design: deposits and withdrawals expose addresses and amounts.",
  distinctive:
    "https://strk20-by-example.org/compliance. Distinctive patterns: recognizable amounts, or rapid in-and-out sequences, weaken the anonymity set.",
  succession:
    "https://strk20-by-example.org/compliance. Channel-open linkability: depositing or withdrawing in tight succession can link activity.",
  inside:
    "https://strk20-by-example.org/what-is-strk20. Inside the pool, sender, receiver, amounts, and notes are private.",
} as const;
