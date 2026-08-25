/**
 * One place that knows what exists on which network.
 *
 * Components must not hard-code a pool, a registry or an RPC. Both registries
 * are deployed and their addresses are public, so they are checked in as
 * defaults and stay overridable by environment. `registry: undefined` remains
 * the honest signal for a network with nothing deployed on it.
 */

import { RpcProvider } from "starknet";
import { POOL_MAINNET, POOL_SEPOLIA } from "./constants";

export type NetworkId = "mainnet" | "sepolia";

export type NetworkConfig = {
  id: NetworkId;
  label: string;
  chainId: string;
  pool: string;
  /** Undefined until the Lens registry is deployed there. */
  registry?: string;
  rpc: string;
  explorer: string;
  /** Block to start event scans from. Zero is fine on a young testnet. */
  registryFromBlock: number;
};

const SEPOLIA_REGISTRY =
  process.env.NEXT_PUBLIC_REGISTRY_SEPOLIA ??
  "0x51056eb3f8f9408185c9ee9fbfab94f3a5d47c7369a3a72c8783296d1d1b936";

const MAINNET_REGISTRY =
  process.env.NEXT_PUBLIC_REGISTRY_MAINNET ??
  "0x7e14bc65e5f759da2a981843c485a948dc6e15548fe0ba51e3ca805ca75fb01";

/**
 * The block the mainnet registry was deployed in. Event scans start here, so
 * `listHolderAuthorizations` never walks the chain from genesis.
 */
const MAINNET_FROM_BLOCK = 13815987;

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    id: "mainnet",
    label: "Starknet mainnet",
    chainId: "0x534e5f4d41494e",
    pool: POOL_MAINNET,
    registry: MAINNET_REGISTRY,
    rpc: process.env.NEXT_PUBLIC_RPC_MAINNET ?? "https://api.cartridge.gg/x/starknet/mainnet",
    explorer: "https://voyager.online",
    registryFromBlock: Number(
      process.env.NEXT_PUBLIC_REGISTRY_FROM_BLOCK_MAINNET ?? MAINNET_FROM_BLOCK,
    ),
  },
  sepolia: {
    id: "sepolia",
    label: "Starknet Sepolia",
    chainId: "0x534e5f5345504f4c4941",
    pool: POOL_SEPOLIA,
    registry: SEPOLIA_REGISTRY,
    rpc: process.env.NEXT_PUBLIC_RPC_SEPOLIA ?? "https://api.cartridge.gg/x/starknet/sepolia",
    explorer: "https://sepolia.voyager.online",
    registryFromBlock: Number(process.env.NEXT_PUBLIC_REGISTRY_FROM_BLOCK_SEPOLIA ?? 0),
  },
};

/** Where a new request defaults to. Both registries are live, so: mainnet. */
export const DEFAULT_NETWORK: NetworkId = MAINNET_REGISTRY ? "mainnet" : "sepolia";

export function networkForChainId(chainId: string): NetworkConfig | undefined {
  try {
    return Object.values(NETWORKS).find((n) => BigInt(n.chainId) === BigInt(chainId));
  } catch {
    return undefined;
  }
}

export function networkForPool(pool: string, chainId: string): NetworkConfig | undefined {
  const byChain = networkForChainId(chainId);
  if (!byChain) return undefined;
  try {
    return BigInt(byChain.pool) === BigInt(pool) ? byChain : undefined;
  } catch {
    return undefined;
  }
}

export function providerFor(network: NetworkConfig): RpcProvider {
  return new RpcProvider({ nodeUrl: network.rpc });
}

export function txUrl(network: NetworkConfig, hash: string): string {
  return `${network.explorer}/tx/${hash}`;
}
