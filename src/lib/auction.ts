import { hash, num } from "starknet";
import * as constants from "@/utils/constants";
import { phaseOf, type Phase } from "./format";

export type AuctionView = {
  id: number;
  lotToken: string;
  lotAmount: bigint;
  bidToken: string;
  maxBid: bigint;
  minBid: bigint;
  bidEnd: number;
  revealEnd: number;
  kind: number;
  bidCount: number;
  settled: boolean;
  winnerBidId: number;
  winningPrice: bigint;
  lotClaimed: boolean;
  proceedsClaimed: boolean;
  listed: boolean;
  phase: Phase;
};

export type BidView = {
  id: number;
  commitment: string;
  deposit: bigint;
  revealed: boolean;
  amount: bigint;
  refundClaimed: boolean;
  exists: boolean;
};

const AUCTION_SELECTOR = num.toHex(hash.getSelectorFromName("get_auction"));
const BID_SELECTOR = num.toHex(hash.getSelectorFromName("get_bid"));
const NEXT_SELECTOR = num.toHex(hash.getSelectorFromName("get_next_auction_id"));

function felt(v: string | number | bigint): bigint {
  return num.toBigInt(v);
}

export function decodeAuction(id: number, data: string[], now = Math.floor(Date.now() / 1000)): AuctionView {
  const bidEnd = Number(felt(data[5] ?? 0));
  const revealEnd = Number(felt(data[6] ?? 0));
  const settled = felt(data[9] ?? 0) !== 0n;
  return {
    id,
    lotToken: num.toHex(data[0] ?? 0),
    lotAmount: felt(data[1] ?? 0),
    bidToken: num.toHex(data[2] ?? 0),
    maxBid: felt(data[3] ?? 0),
    minBid: felt(data[4] ?? 0),
    bidEnd,
    revealEnd,
    kind: Number(felt(data[7] ?? 0)),
    bidCount: Number(felt(data[8] ?? 0)),
    settled,
    winnerBidId: Number(felt(data[10] ?? 0)),
    winningPrice: felt(data[11] ?? 0),
    lotClaimed: felt(data[12] ?? 0) !== 0n,
    proceedsClaimed: felt(data[13] ?? 0) !== 0n,
    listed: felt(data[14] ?? 0) !== 0n,
    phase: phaseOf(now, bidEnd, revealEnd, settled),
  };
}

export async function readNextId(networkIndex: number, helper: string): Promise<number> {
  const provider = constants.myFrontendProviders[networkIndex];
  const res = await provider.callContract({ contractAddress: helper, entrypoint: "get_next_auction_id", calldata: [] });
  const data = (res as any).result ?? res;
  return Number(felt(data[0] ?? 0));
}

export async function readAuction(
  networkIndex: number,
  helper: string,
  id: number
): Promise<AuctionView | null> {
  const provider = constants.myFrontendProviders[networkIndex];
  const res = await provider.callContract({
    contractAddress: helper,
    entrypoint: "get_auction",
    calldata: [num.toHex(id)],
  });
  const data: string[] = (res as any).result ?? res;
  const view = decodeAuction(id, data);
  return view.listed ? view : null;
}

export async function readBid(
  networkIndex: number,
  helper: string,
  auctionId: number,
  bidId: number
): Promise<BidView> {
  const provider = constants.myFrontendProviders[networkIndex];
  const res = await provider.callContract({
    contractAddress: helper,
    entrypoint: "get_bid",
    calldata: [num.toHex(auctionId), num.toHex(bidId)],
  });
  const data: string[] = (res as any).result ?? res;
  return {
    id: bidId,
    commitment: num.toHex(data[0] ?? 0),
    deposit: felt(data[1] ?? 0),
    revealed: felt(data[2] ?? 0) !== 0n,
    amount: felt(data[3] ?? 0),
    refundClaimed: felt(data[4] ?? 0) !== 0n,
    exists: felt(data[5] ?? 0) !== 0n,
  };
}

export async function readBoard(networkIndex: number, helper: string): Promise<AuctionView[]> {
  const next = await readNextId(networkIndex, helper);
  const out: AuctionView[] = [];
  for (let i = 1; i <= next; i++) {
    try {
      const a = await readAuction(networkIndex, helper, i);
      if (a) out.push(a);
    } catch {
      /* skip */
    }
  }
  return out.reverse();
}

export const LEAKS: Record<string, { hides: string[]; shows: string[] }> = {
  list: {
    hides: ["Who listed the lot", "The seller's other notes and balances"],
    shows: [
      "That a lot was listed (token, size, max bid, clock)",
      "A pool → helper transfer of the lot amount",
    ],
  },
  bid: {
    hides: [
      "Who bid",
      "The actual bid amount (every bidder deposits the same max bid)",
      "Which of your notes funded it",
    ],
    shows: [
      "That a bid was placed (a commitment hash)",
      "A pool → helper transfer of exactly max_bid",
      "How many bids the lot has collected",
    ],
  },
  reveal: {
    hides: ["Who revealed (the pool is the caller)"],
    shows: ["The bid amount, once you choose to open it", "Which bid id it belongs to"],
  },
  settle: {
    hides: ["Identities of winner and losers"],
    shows: ["Winning bid id and clearing price", "That settlement ran"],
  },
  claim: {
    hides: ["Who claimed", "Where the tokens go next (they land in an open note you own)"],
    shows: ["Token and amount credited back into the pool", "That a claim of this type happened"],
  },
  shield: {
    hides: ["What you do with the funds after they enter the pool"],
    shows: ["Your public address, token, and amount on the deposit"],
  },
  transfer: {
    hides: ["Sender, recipient, token, amount, and which notes moved"],
    shows: ["That someone interacted with the pool, and when"],
  },
  unshield: {
    hides: ["Which notes funded the withdrawal"],
    shows: ["Recipient address, token, and amount"],
  },
};

void AUCTION_SELECTOR;
void BID_SELECTOR;
void NEXT_SELECTOR;
