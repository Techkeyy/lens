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
  // Cartridge answers on both networks with no key. Verified 2026-08-18.
  // The old blastapi defaults are dead: every method now returns
  // "Blast API is no longer available".
  return network === "mainnet"
    ? "https://api.cartridge.gg/x/starknet/mainnet"
    : "https://api.cartridge.gg/x/starknet/sepolia";
}

/** Index 0 is mainnet, index 2 is sepolia. See Strk20Networks. */
export const myFrontendProviders: ProviderInterface[] = [
  new RpcProvider({ nodeUrl: rpcUrl("mainnet") }),
  new RpcProvider({ nodeUrl: rpcUrl("sepolia") }),
  new RpcProvider({ nodeUrl: rpcUrl("sepolia") }),
];

export const Strk20Networks: Record<number, string> = { 0: "MAINNET", 2: "SEPOLIA" };

export const EXPLORER = {
  0: "https://voyager.online",
  2: "https://sepolia.voyager.online",
} as const;

/**
 * STRK20 privacy pool v2.0. Both addresses ship as PRIVACY_POOL_ADDRESS and
 * SEPOLIA_PRIVACY_POOL_ADDRESS in @avnu/avnu-sdk; the public docs only publish
 * the sepolia one. Both confirmed live on 2026-08-18: get_version returns 2.0
 * and get_note answers an anonymous call.
 */
export const POOL_MAINNET =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

export const POOL_SEPOLIA =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

export function poolForIndex(index: number): string {
  return index === 0 ? POOL_MAINNET : POOL_SEPOLIA;
}

export function sameAddr(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

/** Wallet API >= 0.10 is STRK20-capable. Never probe balances to detect this. */
export function isStrk20Api(versions: string[]): boolean {
  return versions.some((v) => {
    const m = String(v).match(/(\d+)\.(\d+)/);
    if (!m) return false;
    return Number(m[1]) > 0 || Number(m[2]) >= 10;
  });
}
