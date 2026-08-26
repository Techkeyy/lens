/**
 * A disposable mainnet account, used once to prove the prover works.
 *
 *   npx tsx scripts/throwaway-account.ts --new      generate, print the address
 *   npx tsx scripts/throwaway-account.ts            status and live fee estimate
 *   npx tsx scripts/throwaway-account.ts --deploy   deploy, once funded
 *
 * WHY THIS EXISTS
 * ---------------
 * Proving a registration requires `user_addr` to be a *deployed* account,
 * because the pool calls `is_valid_signature` on it during `__execute__`. The
 * obvious shortcut is to use the Lens account with a junk viewing key. That
 * works, and it puts the Lens address one accidental submission away from
 * having a junk key written into its `SetViewingKey` slot, which is write-once
 * and would destroy the registration the whole demo depends on.
 *
 * A throwaway account costs a fraction of a STRK and removes that risk
 * entirely. That is the trade this file exists to make.
 *
 * SECRETS
 * -------
 * The private key is generated locally and written to `.env.throwaway.local`,
 * which `.gitignore` already covers via `.env*.local`. It is never printed and
 * never logged. The public address, public key and class hash are printed,
 * because they are public.
 *
 * This account is disposable by design. It is not a Lens secret, it holds only
 * the gas its own deployment needs, and it can be abandoned the moment the
 * compatibility test is done.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { Account, CallData, RpcProvider, ec, hash, num, stark } from "starknet";

const ENV_FILE = ".env.throwaway.local";
const RPC = process.env.STARKNET_RPC_MAINNET ?? "https://api.cartridge.gg/x/starknet/mainnet";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** The same OpenZeppelin account class the Lens deployer uses. Declared on mainnet. */
const ACCOUNT_CLASS_HASH = "0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";

const NEW = process.argv.includes("--new");
const DEPLOY = process.argv.includes("--deploy");

const fmt = (v: bigint) => (Number(v) / 1e18).toFixed(6);

function fail(message: string): never {
  console.error(`\nREFUSED: ${message}`);
  process.exit(1);
}

function readEnv(name: string): string | undefined {
  if (!existsSync(ENV_FILE)) return undefined;
  return readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim();
}

function generate() {
  if (readEnv("THROWAWAY_PRIVATE_KEY")) {
    fail(
      `${ENV_FILE} already holds a throwaway key.\n` +
        "         Delete the file by hand if you really want a new one, so that a\n" +
        "         funded account is never orphaned by accident.",
    );
  }
  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const address = hash.calculateContractAddressFromHash(
    publicKey,
    ACCOUNT_CLASS_HASH,
    CallData.compile({ publicKey }),
    0,
  );
  appendFileSync(
    ENV_FILE,
    `# Disposable. Generated for the prover compatibility test only.\n` +
      `# Not a Lens secret. Holds only its own deployment gas.\n` +
      `THROWAWAY_PRIVATE_KEY=${privateKey}\n` +
      `THROWAWAY_ADDRESS=${address}\n` +
      `THROWAWAY_PUBLIC_KEY=${publicKey}\n`,
    "utf8",
  );
  console.log(`written to          ${ENV_FILE}, which is gitignored`);
  console.log(`private key         generated locally, not printed`);
  return { address, publicKey };
}

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const chainId = await provider.getChainId();
  if (chainId !== "0x534e5f4d41494e") fail(`Chain is ${chainId}, expected Starknet mainnet.`);

  if (NEW) generate();

  const address = readEnv("THROWAWAY_ADDRESS");
  const publicKey = readEnv("THROWAWAY_PUBLIC_KEY");
  const privateKey = readEnv("THROWAWAY_PRIVATE_KEY");
  if (!address || !privateKey || !publicKey) {
    fail(`No throwaway account yet. Run with --new first.`);
  }

  const balance = await provider
    .callContract({ contractAddress: STRK, entrypoint: "balanceOf", calldata: [address] })
    .then((r) => BigInt(r[0]) + (BigInt(r[1] ?? "0x0") << 128n))
    .catch(() => 0n);

  let deployed = false;
  try {
    await provider.getClassHashAt(address);
    deployed = true;
  } catch {
    deployed = false;
  }

  const account = new Account({ provider, address, signer: privateKey });
  const payload = {
    classHash: ACCOUNT_CLASS_HASH,
    constructorCalldata: CallData.compile({ publicKey }),
    addressSalt: publicKey,
    contractAddress: address,
  };

  console.log(`network             Starknet mainnet`);
  console.log(`purpose             disposable, prover compatibility test only`);
  console.log(`address             ${address}`);
  console.log(`public key          ${publicKey}`);
  console.log(`account class       ${ACCOUNT_CLASS_HASH}`);
  console.log(`deployed            ${deployed ? "YES" : "no"}`);
  console.log(`STRK balance        ${fmt(balance)}`);

  if (deployed) {
    console.log(`\nAlready deployed. Nothing to do.`);
    return;
  }

  // Live estimate. Never assume a figure for something that costs real money.
  let worst = 0n;
  try {
    const fee = await account.estimateAccountDeployFee(payload);
    const bounds = fee.resourceBounds as Record<
      string,
      { max_amount: bigint | string; max_price_per_unit: bigint | string }
    >;
    for (const b of Object.values(bounds)) {
      worst += BigInt(b.max_amount) * BigInt(b.max_price_per_unit);
    }
    console.log(`deploy fee estimate ${fmt(BigInt(fee.overall_fee))} STRK`);
    console.log(`worst-case bound    ${fmt(worst)} STRK`);
  } catch (e) {
    console.log(`deploy fee estimate unavailable: ${(e as Error).message.slice(0, 110)}`);
    console.log(`                    (an unfunded address often cannot be estimated against)`);
  }

  // A margin over the worst case, because gas moves between estimate and send.
  const recommended = worst > 0n ? (worst * 15n) / 10n : 0n;
  if (recommended > 0n) {
    console.log(`\nFUND WITH           ${fmt(recommended)} STRK  (worst case plus 50%)`);
  } else {
    console.log(`\nFUND WITH           a small amount, then re-run this to get a live estimate`);
  }
  console.log(`SEND TO             ${address}`);

  if (!DEPLOY) {
    console.log(`\nNothing was broadcast. Once funded, deploy with:`);
    console.log(`  npx tsx scripts/throwaway-account.ts --deploy`);
    return;
  }

  if (balance === 0n) fail("Not funded yet. Send STRK to the address above first.");
  if (worst > 0n && balance < worst) {
    fail(`Balance ${fmt(balance)} STRK is below the worst-case bound ${fmt(worst)} STRK.`);
  }

  console.log(`\ndeploying…`);
  const { transaction_hash, contract_address } = await account.deployAccount(payload);
  console.log(`tx                  ${transaction_hash}`);
  const receipt = (await provider.waitForTransaction(transaction_hash)) as unknown as {
    execution_status?: string;
    block_number?: number;
  };
  console.log(`status              ${receipt.execution_status} block ${receipt.block_number}`);
  console.log(`deployed at         ${contract_address}`);
  if (BigInt(contract_address) !== BigInt(address)) {
    fail("Deployed address does not match the counterfactual address.");
  }
}

main().catch((e) => {
  console.error(`\nFAILED: ${e?.message ?? e}`);
  process.exit(1);
});
