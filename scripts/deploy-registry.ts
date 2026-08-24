/**
 * Declare and deploy the Lens disclosure registry.
 *
 *   npx tsx scripts/deploy-registry.ts               sepolia
 *   npx tsx scripts/deploy-registry.ts --mainnet     mainnet, needs a real key
 *
 * Build the contract first:
 *   cd cairo && scarb build
 *
 * Declaring is idempotent in practice: if the class is already declared the
 * node rejects it and we carry on to deploy with the class hash we computed
 * locally, so a half-finished run can be repeated safely.
 *
 * Writes the resulting addresses into cairo/address.md so the deployment is
 * recorded in the repo rather than in someone's shell history.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Account, CallData, RpcProvider, hash, json } from "starknet";

const SIERRA = "cairo/target/dev/lens_registry_LensRegistry.contract_class.json";
const CASM = "cairo/target/dev/lens_registry_LensRegistry.compiled_contract_class.json";
const ENV_FILE = ".env.local";

const mainnet = process.argv.includes("--mainnet");
const tight = process.argv.includes("--tight");
const network = mainnet ? "mainnet" : "sepolia";
const KEY_NAME = mainnet ? "MAINNET_PRIVATE_KEY" : "SEPOLIA_PRIVATE_KEY";
const ADDR_NAME = mainnet ? "MAINNET_ADDRESS" : "SEPOLIA_ADDRESS";

const RPC =
  process.env[`STARKNET_RPC_${network.toUpperCase()}`] ??
  `https://api.cartridge.gg/x/starknet/${network}`;

function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!existsSync(ENV_FILE)) return undefined;
  const line = readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

function recordDeployment(classHash: string, address: string) {
  const path = "cairo/address.md";
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "# Lens disclosure registry\n";
  const stamp = new Date().toISOString().slice(0, 10);
  const entry = [
    ``,
    `## ${network}`,
    ``,
    `- deployed: ${stamp}`,
    `- class hash: \`${classHash}\``,
    `- address: \`${address}\``,
    ``,
  ].join("\n");
  writeFileSync(path, previous.replace(new RegExp(`\\n## ${network}[\\s\\S]*?(?=\\n## |$)`), "") + entry);
  console.log(`recorded in ${path}`);
}

async function main() {
  if (!existsSync(SIERRA) || !existsSync(CASM)) {
    console.error(`Missing build output. Run: cd cairo && scarb build`);
    process.exit(1);
  }

  const privateKey = envValue(KEY_NAME);
  const address = envValue(ADDR_NAME);
  if (!privateKey) {
    console.error(`No ${KEY_NAME} in ${ENV_FILE}.`);
    if (!mainnet) console.error(`Run: npx tsx scripts/account.ts --new`);
    process.exit(1);
  }
  if (!address) {
    console.error(
      `No ${ADDR_NAME} in ${ENV_FILE}. Add the deployer account address for ${network}.`,
    );
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: RPC });
  const account = new Account({ provider, address, signer: privateKey });

  const sierra = json.parse(readFileSync(SIERRA, "ascii"));
  const casm = json.parse(readFileSync(CASM, "ascii"));
  const classHash = hash.computeContractClassHash(sierra);

  console.log(`network    ${network}`);
  console.log(`deployer   ${address}`);
  console.log(`class hash ${classHash}`);

  let declared = false;
  try {
    await provider.getClassByHash(classHash);
    console.log(`declare    already declared, skipping`);
    declared = true;
  } catch {
    console.log(`declare    submitting…`);
  }

  if (!declared) {
    // starknet.js pads both the gas amount and the price by 1.5x, so the
    // declared worst case is 2.25x the real cost and the account is rejected
    // for "resource bounds exceed balance" even when it can comfortably afford
    // the transaction. --tight rebuilds the bounds from the raw estimate with a
    // stated margin instead. Gas amount for a declare is deterministic, so the
    // margin is really about the price moving between estimate and inclusion.
    let options = {};
    if (tight) {
      const fee = await account.estimateDeclareFee({ contract: sierra, casm });
      const bounds = fee.resourceBounds as Record<
        string,
        { max_amount: bigint | string; max_price_per_unit: bigint | string }
      >;
      const scale = (v: bigint | string, num: bigint, den: bigint) =>
        (BigInt(v) * num) / den;
      const resourceBounds = Object.fromEntries(
        Object.entries(bounds).map(([resource, b]) => [
          resource,
          {
            // Undo the 1.5x, then add 6% on amount and 8% on price.
            max_amount: scale(b.max_amount, 106n, 150n),
            max_price_per_unit: scale(b.max_price_per_unit, 108n, 150n),
          },
        ]),
      );
      const worst = Object.values(resourceBounds).reduce(
        (sum, b) => sum + b.max_amount * b.max_price_per_unit,
        0n,
      );
      console.log(`declare    tight bounds, worst case ${Number(worst) / 1e18} STRK`);
      options = { resourceBounds };
    }
    const res = await account.declare({ contract: sierra, casm }, options);
    console.log(`declare tx ${res.transaction_hash}`);
    await provider.waitForTransaction(res.transaction_hash);
    console.log(`declared   ${res.class_hash}`);
  }

  console.log(`deploy     submitting…`);
  const deployed = await account.deployContract({
    classHash,
    constructorCalldata: CallData.compile([]),
  });
  console.log(`deploy tx  ${deployed.transaction_hash}`);
  await provider.waitForTransaction(deployed.transaction_hash);
  console.log(`address    ${deployed.contract_address}`);

  recordDeployment(classHash, deployed.contract_address);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
