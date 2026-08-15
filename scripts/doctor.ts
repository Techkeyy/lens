/**
 * Phase 3 self-check: official pool exists, fixture scoring still works.
 * Live event fetch is optional (PROBE_ADDRESS).
 */
import { detectHistory } from "../src/core/detect";
import { fetchPublicEdges } from "../src/core/fetch";
import { loadFixture } from "../src/core/fixture";
import { POOL_MAINNET } from "../src/utils/constants";
import { RpcProvider } from "starknet";

const RPC = process.env.STARKNET_RPC ?? "https://rpc.starknet.lava.build";

async function main() {
  console.log("pool", POOL_MAINNET);
  console.log("rpc", RPC);
  const provider = new RpcProvider({ nodeUrl: RPC });
  try {
    const classHash = await provider.getClassHashAt(POOL_MAINNET);
    console.log("getClassHashAt", classHash);
  } catch (e: any) {
    console.log("getClassHashAt failed", e?.message ?? e);
  }

  const probe = process.env.PROBE_ADDRESS;
  if (probe) {
    try {
      const edges = await fetchPublicEdges(probe, 0);
      console.log("live edges", edges.length);
    } catch (e: any) {
      console.log("live fetch failed (fixture still valid)", e?.message ?? e);
    }
  }

  const ids = detectHistory(loadFixture()).map((f) => f.id);
  console.log("fixture findings", ids);
  if (!ids.includes("rapid-inout-same-amount")) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
