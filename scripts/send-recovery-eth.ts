/**
 * Recover the stranded ETH from the Lens mainnet deployer.
 *
 *   npm run recovery:eth            dry run, the default, sends nothing
 *   npm run recovery:eth -- --send  broadcasts the transfer
 *
 * One purpose, one call: move a fixed amount of ETH from the Lens deployer to
 * the wallet named below. Every parameter is hard-coded and asserted rather
 * than passed in, because a recovery script that accepts a destination
 * argument is a recovery script that can send to the wrong place.
 *
 * There is no swap, no bridge, no approval and no second call. The private key
 * is read from the gitignored .env.local and is never printed, logged or
 * returned.
 */
import { existsSync, readFileSync } from "node:fs";
import { Account, CallData, RpcProvider, cairo, constants, num } from "starknet";

// --- the only values this script will ever act on --------------------------

const SOURCE = "0x47366fff6d7da5f313cf6a379f460c8544db248231a532e533afd588d801aca";
const DESTINATION = "0x04c7082c068f3d78d0637c867041e322a33b03ed70606ad4bd8e5771a13f99c8";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const AMOUNT_WEI = 900_000_000_000_000n; // 0.0009 ETH, exactly
const RPC = process.env.STARKNET_RPC_MAINNET ?? "https://api.cartridge.gg/x/starknet/mainnet";
const ENV_FILE = ".env.local";

const SEND = process.argv.includes("--send");
const fmt = (v: bigint, d = 18) => (Number(v) / 10 ** d).toString();

function fail(message: string): never {
  console.error(`\nREFUSED: ${message}`);
  process.exit(1);
}

function readKey(): string {
  if (!existsSync(ENV_FILE)) fail(`${ENV_FILE} not found. The key is not in the repository by design.`);
  const line = readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("MAINNET_PRIVATE_KEY="));
  const key = line?.slice("MAINNET_PRIVATE_KEY=".length).trim();
  if (!key) fail(`No MAINNET_PRIVATE_KEY in ${ENV_FILE}.`);
  return key;
}

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });

  // --- assertions, before anything is signed -------------------------------
  const chainId = await provider.getChainId();
  if (chainId !== constants.StarknetChainId.SN_MAIN) {
    fail(`Chain is ${chainId}, expected Starknet mainnet.`);
  }
  if (BigInt(DESTINATION) === BigInt(SOURCE)) fail("Destination equals source.");
  if (AMOUNT_WEI !== 900_000_000_000_000n) fail("Amount is not the approved 0.0009 ETH.");

  const account = new Account({ provider, address: SOURCE, signer: readKey() });
  if (BigInt(account.address) !== BigInt(SOURCE)) {
    fail("Reconstructed account address does not match the Lens deployer.");
  }

  const classAt = async (a: string) => {
    try {
      return await provider.getClassHashAt(a);
    } catch {
      return null;
    }
  };
  if (!(await classAt(SOURCE))) fail("Source account is not deployed.");
  if (!(await classAt(DESTINATION))) {
    fail("Destination is not deployed. Sending there could strand the funds.");
  }

  // --- balances, read fresh immediately before acting ----------------------
  const balanceOf = async (token: string) => {
    const r = await provider.callContract({
      contractAddress: token,
      entrypoint: "balanceOf",
      calldata: [SOURCE],
    });
    return BigInt(r[0]) + (BigInt(r[1] ?? "0x0") << 128n);
  };
  const ethBefore = await balanceOf(ETH);
  const strkBefore = await balanceOf(STRK);

  if (ethBefore < AMOUNT_WEI) {
    fail(`Source holds ${fmt(ethBefore)} ETH, less than the ${fmt(AMOUNT_WEI)} ETH to send.`);
  }

  // --- the single call -----------------------------------------------------
  const call = {
    contractAddress: ETH,
    entrypoint: "transfer",
    calldata: CallData.compile({
      recipient: DESTINATION,
      amount: cairo.uint256(AMOUNT_WEI),
    }),
  };

  const fee = await account.estimateInvokeFee([call]);
  const bounds = fee.resourceBounds as Record<
    string,
    { max_amount: bigint | string; max_price_per_unit: bigint | string }
  >;
  let worstFee = 0n;
  for (const b of Object.values(bounds)) {
    worstFee += BigInt(b.max_amount) * BigInt(b.max_price_per_unit);
  }
  if (worstFee >= strkBefore) {
    fail(`Fee bound ${fmt(worstFee)} STRK exceeds the ${fmt(strkBefore)} STRK balance.`);
  }

  console.log(`mode                ${SEND ? "SEND" : "DRY RUN"}`);
  console.log(`network             Starknet mainnet (${chainId})`);
  console.log(`source              ${SOURCE}`);
  console.log(`destination         ${DESTINATION}`);
  console.log(`token               ${ETH}`);
  console.log(`entrypoint          transfer`);
  console.log(`calldata            ${JSON.stringify(call.calldata.map((c) => num.toHex(c)))}`);
  console.log(`amount              ${fmt(AMOUNT_WEI)} ETH`);
  console.log(`calls in tx         1`);
  console.log("");
  console.log(`ETH before          ${fmt(ethBefore)}`);
  console.log(`STRK before         ${fmt(strkBefore)}`);
  console.log(`estimated fee       ${fmt(BigInt(fee.overall_fee))} STRK`);
  console.log(`worst-case fee      ${fmt(worstFee)} STRK`);
  console.log(`ETH after           ${fmt(ethBefore - AMOUNT_WEI)}`);
  console.log(`STRK after (worst)  ${fmt(strkBefore - worstFee)}`);

  if (!SEND) {
    console.log("\nSAFE TO SEND: YES");
    console.log("Nothing was broadcast. To execute, re-run with --send:");
    console.log("  npm run recovery:eth -- --send");
    return;
  }

  console.log("\nsubmitting…");
  const { transaction_hash } = await account.execute([call]);
  console.log(`tx                  ${transaction_hash}`);
  const receipt = await provider.waitForTransaction(transaction_hash);
  const r = receipt as unknown as {
    execution_status?: string;
    finality_status?: string;
    block_number?: number;
  };
  console.log(`status              ${r.execution_status} ${r.finality_status}`);
  console.log(`block               ${r.block_number}`);

  const ethAfter = await balanceOf(ETH);
  const strkAfter = await balanceOf(STRK);
  console.log(`ETH after           ${fmt(ethAfter)}`);
  console.log(`STRK after          ${fmt(strkAfter)}`);
  console.log("\nVerify independently with:");
  console.log(`  npx tsx scripts/verify-recovery-eth.ts ${transaction_hash}`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e?.message ?? e}`);
  process.exit(1);
});
