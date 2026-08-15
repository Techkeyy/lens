import type { PublicEdge } from "./types";
import sample from "../../fixtures/sample-history.json";

export function loadFixture(): PublicEdge[] {
  return sample.edges.map((e) => ({
    kind: e.kind as PublicEdge["kind"],
    token: e.token,
    amount: BigInt(e.amount),
    timestamp: e.timestamp,
    txHash: e.txHash,
  }));
}
