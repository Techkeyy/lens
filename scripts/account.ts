/**
 * Sepolia test account for the disclosure round trip.
 *
 * We need a real shielded payment on a real network to prove that a channel
 * key we derived ourselves locates and decrypts a note the pool actually
 * wrote. That needs a funded account, which is what this script sets up.
 *
 *   npx tsx scripts/account.ts            show address, balance, deploy state
 *   npx tsx scripts/account.ts --new      generate a key into .env.local
 *   npx tsx scripts/account.ts --deploy   deploy once the address is funded
 *
 * The key lives in .env.local, which is gitignored. Sepolia only. Never point
 * this at mainnet and never commit the key.
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { Account, CallData, RpcProvider, ec, hash, num, stark } from "starknet";

const ENV_FILE = ".env.local";
const KEY_NAME = "SEPOLIA_PRIVATE_KEY";
const RPC = process.env.STARKNET_RPC_SEPOLIA ?? "https://api.cartridge.gg/x/starknet/sepolia";

/** OpenZeppelin account, declared on Sepolia. Constructor takes public_key. */
const ACCOUNT_CLASS_HASH =
  "0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";

/** Fee token on Sepolia. Same address on every Starknet network. */
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

function readEnvKey(): string | undefined {
  if (process.env[KEY_NAME]) return process.env[KEY_NAME];
  if (!existsSync(ENV_FILE)) return undefined;
  const line = readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${KEY_NAME}=`));
  return line?.slice(KEY_NAME.length + 1).trim() || undefined;
}

function writeEnvKey(privateKey: string) {
  const entry = `${KEY_NAME}=${privateKey}\n`;
  if (!existsSync(ENV_FILE)) writeFileSync(ENV_FILE, entry);
  else appendFileSync(ENV_FILE, (readFileSync(ENV_FILE, "utf8").endsWith("\n") ? "" : "\n") + entry);
}

/**
 * Counterfactual address: derivable before the account exists on chain, which
 * is what lets us fund it first and deploy second.
 */
function addressFor(privateKey: string): { publicKey: string; address: string } {
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const address = hash.calculateContractAddressFromHash(
    publicKey,
    ACCOUNT_CLASS_HASH,
    CallData.compile({ public_key: publicKey }),
    0,
  );
  return { publicKey, address };
}

async function strkBalance(provider: RpcProvider, address: string): Promise<bigint> {
  try {
    const res = await provider.callContract({
      contractAddress: STRK,
      entrypoint: "balanceOf",
      calldata: [address],
    });
    // u256 is returned as (low, high).
    return BigInt(res[0]) + (BigInt(res[1] ?? "0x0") << 128n);
  } catch {
    return 0n;
  }
}

async function isDeployed(provider: RpcProvider, address: string): Promise<boolean> {
  try {
    await provider.getClassHashAt(address);
    return true;
  } catch {
    return false;
  }
}

const fmt = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(4)} STRK`;

async function main() {
  const args = process.argv.slice(2);
  const provider = new RpcProvider({ nodeUrl: RPC });

  let privateKey = readEnvKey();

  if (args.includes("--new")) {
    if (privateKey) {
      console.log(`${KEY_NAME} already set in ${ENV_FILE}. Remove it first to rotate.`);
      process.exit(1);
    }
    privateKey = num.toHex(stark.randomAddress());
    writeEnvKey(privateKey);
    console.log(`wrote a new ${KEY_NAME} to ${ENV_FILE} (gitignored)`);
  }

  if (!privateKey) {
    console.log(`No ${KEY_NAME}. Run: npx tsx scripts/account.ts --new`);
    process.exit(1);
  }

  const { publicKey, address } = addressFor(privateKey);
  const deployed = await isDeployed(provider, address);
  const balance = await strkBalance(provider, address);

  console.log(`network    sepolia`);
  console.log(`rpc        ${RPC}`);
  console.log(`public key ${publicKey}`);
  console.log(`address    ${address}`);
  console.log(`deployed   ${deployed ? "yes" : "no"}`);
  console.log(`balance    ${fmt(balance)}`);

  if (!deployed && balance === 0n) {
    console.log(`\nFund this address with Sepolia STRK, then run --deploy:`);
    console.log(`  https://faucet.starknet.io/   (official, Starknet Foundation)`);
    console.log(`  address: ${address}`);
    return;
  }

  if (args.includes("--deploy")) {
    if (deployed) {
      console.log("\nalready deployed, nothing to do");
      return;
    }
    console.log("\ndeploying account…");
    const account = new Account({ provider, address, signer: privateKey });
    const { transaction_hash, contract_address } = await account.deployAccount({
      classHash: ACCOUNT_CLASS_HASH,
      constructorCalldata: CallData.compile({ public_key: publicKey }),
      addressSalt: publicKey,
    });
    console.log(`tx         ${transaction_hash}`);
    await provider.waitForTransaction(transaction_hash);
    console.log(`deployed   ${contract_address}`);
  } else if (!deployed) {
    console.log(`\nfunded but not deployed. Run: npx tsx scripts/account.ts --deploy`);
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
