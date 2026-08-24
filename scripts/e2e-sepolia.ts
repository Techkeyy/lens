/**
 * End to end against the deployed Sepolia registry.
 *
 *   npx tsx scripts/e2e-sepolia.ts
 *
 * What is real: the commitment is produced by the same `createDisclosure` the
 * interface calls, and the authorize, status read and revoke all happen on the
 * live contract. That is the whole registry half of the product.
 *
 * What is a fixture: the STRK20 relationship itself. Creating a genuine
 * shielded payment needs the STRK20 proving service, which is not published,
 * so the payments here come from the in-memory pool used by the tests. This is
 * labelled everywhere it appears and is never written into strk20.json.
 */
import { readFileSync } from "node:fs";
import { Account, RpcProvider } from "starknet";
import { createDisclosure } from "../src/core/disclose";
import { makeRequest } from "../src/core/bundle";
import { buildProofLink } from "../src/core/transport";
import { publicViewingKey } from "../src/core/session";
import { verifyDisclosure } from "../src/core/claim";
import { twoPartyWorld } from "../src/core/testing/fakePool";
import {
  DisclosureStatus,
  authorizeDisclosure,
  getDisclosureStatus,
  listHolderAuthorizations,
  revokeDisclosure,
} from "../src/core/registry";
import { NETWORKS } from "../src/utils/networks";

const NET = NETWORKS.sepolia;
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

const env = (n: string) =>
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${n}=`))
    ?.slice(n.length + 1)
    .trim();

const label = (s: DisclosureStatus) => DisclosureStatus[s];

async function main() {
  const holder = env("SEPOLIA_ADDRESS")!;
  const counterparty = "0x0e11907e2000000000000000000000000000000000000000000000000000001";
  const holderViewingKey = 0x0a11ce5eecen;

  console.log("network      sepolia");
  console.log("registry    ", NET.registry);
  console.log("holder      ", holder);
  console.log("relationship FIXTURE (proving service unavailable, see docs/DEV_EVIDENCE.md)\n");

  // --- fixture relationship -------------------------------------------------
  const world = twoPartyWorld({
    holder,
    holderViewingKey,
    counterparty,
    counterpartyViewingKey: 0x0e11907e25ecn,
    token: USDC,
  });
  world.pool.pay(world.inbound, USDC, 3_000_000_000n);
  world.pool.pay(world.inbound, USDC, 3_000_000_000n);

  const session = {
    address: holder,
    chainId: NET.chainId,
    pool: NET.pool,
    viewingKey: holderViewingKey,
    publicKey: publicViewingKey(holderViewingKey),
  };
  const request = makeRequest({
    chainId: NET.chainId,
    pool: NET.pool,
    requester: "Northside Lettings",
    purpose: "Proof of income for a tenancy application",
    counterparty,
    token: USDC,
  });

  const { disclosure, commitment, warnings } = await createDisclosure(
    world.pool,
    session,
    request,
  );
  console.log("commitment  ", commitment);
  console.log("snapshot    ", JSON.stringify(disclosure.snapshot));
  console.log("consent     ", warnings.length, "warnings shown before approval");

  const before = await verifyDisclosure(world.pool, disclosure);
  console.log("pool check  ", before.verified ? "verified" : `failed: ${before.failure}`);

  // --- the real part --------------------------------------------------------
  const provider = new RpcProvider({ nodeUrl: NET.rpc });
  const account = new Account({
    provider,
    address: holder,
    signer: env("SEPOLIA_PRIVATE_KEY")!,
  });

  console.log("\nstatus      ", label(await getDisclosureStatus(provider, NET.registry!, commitment)));

  const authTx = await authorizeDisclosure(account, NET.registry!, commitment, 0);
  console.log("authorize   ", authTx);
  await provider.waitForTransaction(authTx);
  const active = await getDisclosureStatus(provider, NET.registry!, commitment);
  console.log("status      ", label(active));

  const link = buildProofLink("http://localhost:3000", disclosure);
  console.log("\nproof link (open in a browser with no wallet):");
  console.log(link.url);

  const revokeTx = await revokeDisclosure(account, NET.registry!, commitment);
  console.log("\nrevoke      ", revokeTx);
  await provider.waitForTransaction(revokeTx);
  const revoked = await getDisclosureStatus(provider, NET.registry!, commitment);
  console.log("status      ", label(revoked));

  const history = await listHolderAuthorizations(provider, NET.registry!, holder, {
    fromBlock: NET.registryFromBlock,
  });
  console.log("history     ", history.length, "disclosure(s) rebuilt from chain events");

  const pass = active === DisclosureStatus.Active && revoked === DisclosureStatus.Revoked;
  console.log(`\ne2e         ${pass ? "PASS" : "FAIL"}`);
  if (!pass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
