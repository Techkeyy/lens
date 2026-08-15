import { RpcProvider, hash, num } from "starknet";
import { POOL_MAINNET, addrSTRK, myFrontendProviders } from "@/utils/constants";
import type { PublicEdge } from "./types";

function pad(addr: string): string {
  const hex = num.toHex(addr).slice(2).toLowerCase();
  return "0x" + hex.padStart(64, "0");
}

function amountFromData(data: string[]): bigint {
  if (!data?.length) return 0n;
  return num.toBigInt(data[data.length - 1] ?? 0);
}

const timeCache = new Map<number, number>();

async function blockTime(provider: RpcProvider, block?: number): Promise<number> {
  if (block == null) return Math.floor(Date.now() / 1000);
  const hit = timeCache.get(block);
  if (hit) return hit;
  try {
    const b: any = await provider.getBlock(block);
    const t = Number(b.timestamp ?? 0);
    timeCache.set(block, t);
    return t;
  } catch {
    return 0;
  }
}

/**
 * Public edges only. Filter Deposit.user_addr and Withdrawal.to_addr.
 * Never filter on transaction sender. That is a relayer.
 */
export async function fetchPublicEdges(address: string, networkIndex: number): Promise<PublicEdge[]> {
  const provider = myFrontendProviders[networkIndex] as RpcProvider;
  const pool = POOL_MAINNET;
  const user = pad(address);
  const depositSel = num.toHex(hash.getSelectorFromName("Deposit"));
  const withdrawSel = num.toHex(hash.getSelectorFromName("Withdrawal"));

  let to = 0;
  try {
    to = await provider.getBlockNumber();
  } catch {
    to = 0;
  }
  const from = to ? Math.max(0, to - 80_000) : 0;
  const range = {
    from_block: { block_number: from },
    to_block: to ? { block_number: to } : ("latest" as const),
    chunk_size: 400,
  };

  const [deposits, withdrawals] = await Promise.all([
    provider.getEvents({
      address: pool,
      ...range,
      keys: [[depositSel], [user]],
    }),
    provider.getEvents({
      address: pool,
      ...range,
      keys: [[withdrawSel], [user]],
    }),
  ]);

  const edges: PublicEdge[] = [];
  for (const ev of deposits.events ?? []) {
    const keys = ev.keys ?? [];
    edges.push({
      kind: "shield",
      token: keys[2] ? num.toHex(keys[2]) : "0x0",
      amount: amountFromData(ev.data ?? []),
      timestamp: await blockTime(provider, ev.block_number),
      txHash: ev.transaction_hash,
    });
  }
  for (const ev of withdrawals.events ?? []) {
    const keys = ev.keys ?? [];
    edges.push({
      kind: "unshield",
      token: keys[2] ? num.toHex(keys[2]) : "0x0",
      amount: amountFromData(ev.data ?? []),
      timestamp: await blockTime(provider, ev.block_number),
      txHash: ev.transaction_hash,
    });
  }
  return edges.sort((a, b) => a.timestamp - b.timestamp);
}

export async function fetchPublicStrkBalance(
  address: string,
  networkIndex: number
): Promise<bigint | null> {
  try {
    const provider = myFrontendProviders[networkIndex];
    const res: any = await provider.callContract({
      contractAddress: addrSTRK,
      entrypoint: "balanceOf",
      calldata: [address],
    });
    const data = res?.result ?? res;
    const low = num.toBigInt(data[0] ?? 0);
    const high = data[1] ? num.toBigInt(data[1]) : 0n;
    return low + (high << 128n);
  } catch {
    return null;
  }
}

export async function fetchFeeAmount(networkIndex: number): Promise<bigint | null> {
  try {
    const provider = myFrontendProviders[networkIndex];
    const res: any = await provider.callContract({
      contractAddress: POOL_MAINNET,
      entrypoint: "get_fee_amount",
      calldata: [],
    });
    const data = res?.result ?? res;
    return num.toBigInt(data[0] ?? 0);
  } catch {
    return null;
  }
}
