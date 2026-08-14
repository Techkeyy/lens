import { ProviderInterface, RpcProvider } from "starknet";

export const addrSTRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export const addrUSDC =
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

function rpcUrl(network: "mainnet" | "sepolia"): string {
  const full =
    network === "mainnet"
      ? process.env.NEXT_PUBLIC_RPC_MAINNET
      : process.env.NEXT_PUBLIC_RPC_SEPOLIA;
  if (full) return full;
  const key = process.env.NEXT_PUBLIC_ALCHEMY_KEY || process.env.NEXT_PUBLIC_PROVIDER_URL;
  if (key && key !== "your_alchemy_key_here") {
    return `https://starknet-${network}.g.alchemy.com/v2/${key}`;
  }
  return network === "mainnet"
    ? "https://rpc.starknet.lava.build"
    : "https://starknet-sepolia.public.blastapi.io/rpc/v0_8";
}

export const myFrontendProviders: ProviderInterface[] = [
  new RpcProvider({ nodeUrl: rpcUrl("mainnet") }),
  new RpcProvider({ nodeUrl: "https://starknet-testnet.public.blastapi.io/rpc/v0_7" }),
  new RpcProvider({ nodeUrl: rpcUrl("sepolia") }),
];

export const TenderHelperMainnet = process.env.NEXT_PUBLIC_TENDER_HELPER_MAINNET ?? "0x0";
export const TenderHelperSepolia = process.env.NEXT_PUBLIC_TENDER_HELPER_SEPOLIA ?? "0x0";
export const TenderHelperClassHash = process.env.NEXT_PUBLIC_TENDER_CLASS_HASH ?? "0x0";

export function tenderHelperForIndex(index: number): string {
  if (index === 0) return TenderHelperMainnet;
  if (index === 2) return TenderHelperSepolia;
  return "0x0";
}

export const Strk20Networks: Record<number, string> = { 0: "MAINNET", 2: "SEPOLIA" };

export const OP = {
  LIST: 0,
  BID: 1,
  REVEAL: 2,
  CLAIM_WIN: 3,
  CLAIM_PROCEEDS: 4,
  CLAIM_REFUND: 5,
  CLAIM_UNSOLD: 6,
} as const;

export const KIND = {
  FIRST_PRICE: 0,
  VICKREY: 1,
} as const;

export const BID_COMMITMENT_TAG = "TENDER_BID_COMMIT:V1";

export const EXPLORER = {
  0: "https://voyager.online",
  2: "https://sepolia.voyager.online",
} as const;
