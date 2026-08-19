/**
 * Deployer accounts for Lens.
 *
 *   npx tsx scripts/account.ts              show address, balance, deploy state
 *   npx tsx scripts/account.ts --new        generate a key into .env.local
 *   npx tsx scripts/account.ts --deploy     deploy once the address is funded
 *   ... --mainnet                           operate on mainnet instead
 *
 * Sepolia exists to rehearse the pool round trip before spending real funds.
 * Mainnet is the deliverable: the sprint scores a working mainnet product and
 * wants real transaction hashes.
 *
 * Keys live in .env.local, which is gitignored. The mainnet key is a dedicated
 * deployer, funded with only what the deployment needs. Never put a personal
 * wallet key here, and never commit this file.
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { Account, CallData, RpcProvider, ec, hash, num, stark } from "starknet";

const ENV_FILE = ".env.local";
const MAINNET = process.argv.includes("--mainnet");
const NETWORK = MAINNET ? "mainnet" : "sepolia";
const KEY_NAME = MAINNET ? "MAINNET_PRIVATE_KEY" : "SEPOLIA_PRIVATE_KEY";
const ADDR_NAME = MAINNET ? "MAINNET_ADDRESS" : "SEPOLIA_ADDRESS";
const RPC =
  process.env[`STARKNET_RPC_${NETWORK.toUpperCase()}`] ??
  `https://api.cartridge.gg/x/starknet/${NETWORK}`;

/** OpenZeppelin account. Constructor takes public_key. Declared on both nets. */
const ACCOUNT_CLASS_HASH =
  "0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";

/** Fee token. Same address on every Starknet network. */
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

function readEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!existsSync(ENV_FILE)) return undefined;
  const line = readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

function writeEnv(name: string, value: string) {
  if (readEnv(name) === value) return;
  const entry = `${name}=${value}\n`;
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

  let privateKey = readEnv(KEY_NAME);

  if (args.includes("--new")) {
    if (privateKey) {
      console.log(`${KEY_NAME} already set in ${ENV_FILE}. Remove it first to rotate.`);
      process.exit(1);
    }
    privateKey = num.toHex(stark.randomAddress());
    writeEnv(KEY_NAME, privateKey);
    console.log(`wrote a new ${KEY_NAME} to ${ENV_FILE} (gitignored)`);
  }

  if (!privateKey) {
    console.log(`No ${KEY_NAME}. Run: npx tsx scripts/account.ts --new`);
    process.exit(1);
  }

  const { publicKey, address } = addressFor(privateKey);
  // deploy-registry.ts reads this, so record it as soon as it is known.
  writeEnv(ADDR_NAME, address);
  const deployed = await isDeployed(provider, address);
  const balance = await strkBalance(provider, address);

  console.log(`network    ${NETWORK}`);
  console.log(`rpc        ${RPC}`);
  console.log(`public key ${publicKey}`);
  console.log(`address    ${address}`);
  console.log(`deployed   ${deployed ? "yes" : "no"}`);
  console.log(`balance    ${fmt(balance)}`);

  if (!deployed && balance === 0n) {
    if (MAINNET) {
      console.log(`\nSend mainnet STRK to this address, then run --deploy --mainnet:`);
      console.log(`  address: ${address}`);
      console.log(`  50 STRK covers the whole deployment and costs about a dollar.`);
    } else {
      console.log(`\nFund this address with Sepolia STRK, then run --deploy:`);
      console.log(`  npx tsx scripts/faucet.ts`);
      console.log(`  or https://faucet.starknet.io/`);
      console.log(`  address: ${address}`);
    }
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
