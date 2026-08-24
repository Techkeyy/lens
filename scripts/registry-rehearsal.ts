/**
 * Exercise the deployed registry end to end, through the real client.
 *
 *   npx tsx scripts/registry-rehearsal.ts             sepolia
 *   npx tsx scripts/registry-rehearsal.ts --mainnet   mainnet
 *
 * Authorize a synthetic commitment, read it back as a walletless Verifier
 * would, revoke it, read it again, and list the Holder's history from chain
 * events. This is the only way to know the Cairo tests and the TypeScript
 * client agree about the same contract.
 *
 * The commitment is a throwaway hash of a fixed string. No real disclosure and
 * no key material is involved.
 */
import { readFileSync } from "node:fs";
import { Account, RpcProvider, ec } from "starknet";
import {
  DisclosureStatus,
  authorizeDisclosure,
  getAuthorization,
  getDisclosureStatus,
  listHolderAuthorizations,
  revokeDisclosure,
} from "../src/core/registry";

const mainnet = process.argv.includes("--mainnet");
const network = mainnet ? "mainnet" : "sepolia";
const RPC =
  process.env[`STARKNET_RPC_${network.toUpperCase()}`] ??
  `https://api.cartridge.gg/x/starknet/${network}`;

const env = (n: string) =>
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${n}=`))
    ?.slice(n.length + 1)
    .trim();

function registryAddress(): string {
  const fromEnv = env(mainnet ? "MAINNET_REGISTRY" : "SEPOLIA_REGISTRY");
  if (fromEnv) return fromEnv;
  const doc = readFileSync("cairo/address.md", "utf8");
  const section = doc.split(`## ${network}`)[1];
  const match = section?.match(/- address: `(0x[0-9a-fA-F]+)`/);
  if (!match) throw new Error(`No ${network} registry address in cairo/address.md`);
  return match[1];
}

const label = (s: DisclosureStatus) => DisclosureStatus[s];

async function main() {
  const registry = registryAddress();
  const provider = new RpcProvider({ nodeUrl: RPC });
  const address = env(mainnet ? "MAINNET_ADDRESS" : "SEPOLIA_ADDRESS")!;
  const account = new Account({
    provider,
    address,
    signer: env(mainnet ? "MAINNET_PRIVATE_KEY" : "SEPOLIA_PRIVATE_KEY")!,
  });

  // Deterministic per run, so a repeat does not collide with the previous one.
  const commitment =
    "0x" +
    ec.starkCurve
      .poseidonHashMany([BigInt(Date.now()), 0x1e2n])
      .toString(16);

  console.log(`network     ${network}`);
  console.log(`registry    ${registry}`);
  console.log(`holder      ${address}`);
  console.log(`commitment  ${commitment}\n`);

  console.log(`before      ${label(await getDisclosureStatus(provider, registry, commitment))}`);

  const authTx = await authorizeDisclosure(account, registry, commitment, 0);
  console.log(`authorize   ${authTx}`);
  await provider.waitForTransaction(authTx);

  const active = await getDisclosureStatus(provider, registry, commitment);
  const auth = await getAuthorization(provider, registry, commitment);
  console.log(`status      ${label(active)}`);
  console.log(`holder      ${auth?.holder}`);
  console.log(`created_at  ${auth?.createdAt}`);

  const revokeTx = await revokeDisclosure(account, registry, commitment);
  console.log(`revoke      ${revokeTx}`);
  await provider.waitForTransaction(revokeTx);

  const revoked = await getDisclosureStatus(provider, registry, commitment);
  console.log(`status      ${label(revoked)}`);

  const history = await listHolderAuthorizations(provider, registry, address, {
    fromBlock: 0,
  });
  console.log(`history     ${history.length} disclosure(s) reconstructed from events`);
  for (const row of history) {
    console.log(`   ${row.commitment.slice(0, 14)}…  ${label(row.status)}  created ${row.createdAt}`);
  }

  const ok = active === DisclosureStatus.Active && revoked === DisclosureStatus.Revoked;
  console.log(`\nrehearsal   ${ok ? "PASS" : "FAIL"}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
