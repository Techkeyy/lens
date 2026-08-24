/**
 * Point Lens core at a real relationship on a real network.
 *
 *   npx tsx scripts/verify-relationship.ts <holder> <counterparty> [--mainnet]
 *
 * Everything Lens does before a disclosure exists, run against the live pool
 * and printed step by step: registration reads, outbound derivation, inbound
 * ECDH recovery, channel binding, subchannel binding, note reads, amounts.
 *
 * Until now every one of those paths was proven offline against an in-memory
 * pool. This is the script that proves them against the real thing, and it is
 * the first thing to run the moment a genuine relationship exists.
 *
 * The holder's viewing key is derived from a private key held only in
 * .env.local. No key of any kind is printed: channel keys are reported as
 * present or absent, never as values.
 */
import { readFileSync } from "node:fs";
import { resolveRelationship } from "../src/core/channels";
import { countNotes, poolReader, scanRange } from "../src/core/read";
import { deriveViewingKeyFromPrivateKey, publicViewingKey } from "../src/core/session";
import { computeChannelMarker, computeSubchannelMarker } from "../src/core/derive";
import { formatAmount, shortAddress, tokenInfo } from "../src/core/view";
import { NETWORKS, providerFor } from "../src/utils/networks";

const mainnet = process.argv.includes("--mainnet");
const NET = mainnet ? NETWORKS.mainnet : NETWORKS.sepolia;
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const token = process.env.LENS_TOKEN ?? USDC;

const env = (n: string) =>
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${n}=`))
    ?.slice(n.length + 1)
    .trim();

const ok = (label: string, detail: string) => console.log(`  ok    ${label.padEnd(26)} ${detail}`);
const no = (label: string, detail: string) => console.log(`  --    ${label.padEnd(26)} ${detail}`);

async function main() {
  const holder = args[0] ?? env(mainnet ? "MAINNET_ADDRESS" : "SEPOLIA_ADDRESS");
  const counterparty = args[1];
  if (!holder || !counterparty) {
    console.error("usage: verify-relationship.ts <holder> <counterparty> [--mainnet]");
    process.exit(1);
  }

  const privateKey = env(mainnet ? "MAINNET_PRIVATE_KEY" : "SEPOLIA_PRIVATE_KEY");
  if (!privateKey) {
    console.error(`No private key for ${NET.id} in .env.local`);
    process.exit(1);
  }

  const asset = tokenInfo(token);
  console.log(`network        ${NET.label}`);
  console.log(`pool           ${NET.pool}`);
  console.log(`holder         ${holder}`);
  console.log(`counterparty   ${counterparty}`);
  console.log(`asset          ${asset.symbol}\n`);

  const viewingKey = deriveViewingKeyFromPrivateKey(privateKey, NET.chainId, NET.pool);
  const holderPub = publicViewingKey(viewingKey);
  console.log("viewing key    derived from the account key, not printed");

  const reader = poolReader(providerFor(NET), NET.pool);

  // --- registration ---------------------------------------------------------
  const onChainHolderPub = await reader.getPublicKey(holder);
  if (onChainHolderPub === 0n) {
    no("holder registration", "not registered with the pool");
  } else if (onChainHolderPub === holderPub) {
    ok("holder registration", "registered, and matches the Lens-derived key");
  } else {
    no(
      "holder registration",
      "registered with a DIFFERENT viewing key, so Lens cannot read this account",
    );
  }

  const counterpartyPub = await reader.getPublicKey(counterparty);
  if (counterpartyPub === 0n) no("counterparty registration", "not registered with the pool");
  else ok("counterparty registration", "registered");

  // --- relationship ---------------------------------------------------------
  const relationship = await resolveRelationship(reader, holder, viewingKey, counterparty);

  if (relationship.outboundKey === undefined) {
    no("outbound lane", "no lane from holder to counterparty");
  } else {
    const marker = computeChannelMarker(
      relationship.outboundKey,
      holder,
      counterparty,
      counterpartyPub,
    );
    ok("outbound lane", `found, channel_exists=${await reader.channelExists(marker)}`);
  }

  if (relationship.inboundKey === undefined) {
    no("inbound lane", "no lane from counterparty to holder, or ECDH did not recover it");
  } else {
    const marker = computeChannelMarker(
      relationship.inboundKey,
      counterparty,
      holder,
      onChainHolderPub,
    );
    ok("inbound lane", `recovered by ECDH, channel_exists=${await reader.channelExists(marker)}`);
  }

  // --- notes ----------------------------------------------------------------
  let populated = 0;
  for (const direction of ["outbound", "inbound"] as const) {
    const key = direction === "outbound" ? relationship.outboundKey : relationship.inboundKey;
    if (key === undefined) continue;

    const recipient = direction === "outbound" ? counterparty : holder;
    const recipientPub = direction === "outbound" ? counterpartyPub : onChainHolderPub;
    const subMarker = computeSubchannelMarker(key, recipient, recipientPub, token);
    const hasAsset = await reader.subchannelExists(subMarker);

    const count = await countNotes(reader, key, token);
    if (count === 0) {
      no(`${direction} notes`, `subchannel_exists=${hasAsset}, 0 notes (lane not disclosed)`);
      continue;
    }
    populated += 1;

    const { notes, missingIndex } = await scanRange(reader, key, token, count);
    if (missingIndex !== undefined) {
      no(`${direction} notes`, `gap at index ${missingIndex}, which should be impossible`);
      continue;
    }
    const total = notes.reduce((s, n) => s + n.amount, 0n);
    ok(
      `${direction} notes`,
      `${count} note(s), total ${formatAmount(total, asset.decimals)} ${asset.symbol}`,
    );
    for (const n of notes) {
      console.log(
        `          #${n.index + 1} ${formatAmount(n.amount, asset.decimals)} ${asset.symbol}`,
      );
    }
  }

  console.log(
    `\nverdict        ${
      populated > 0
        ? `Lens can disclose this relationship (${populated} populated lane(s))`
        : "nothing to disclose between " +
          `${shortAddress(holder)} and ${shortAddress(counterparty)}`
    }`,
  );
  if (populated === 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
