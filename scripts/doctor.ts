/**
 * Self-check against reality, run before trusting anything downstream.
 *
 * Checks, per network:
 *   1. the pool is deployed and reports a version
 *   2. get_note answers an anonymous caller, which is what makes a Lens
 *      disclosure verifiable by someone holding no key at all
 *   3. nullifier_exists answers, which is the spent-or-not check
 *   4. our derive module still matches the Cairo reference vectors
 *   5. the offline fixture still scores
 *
 * Exits non-zero if any hard check fails. Network flakiness on one endpoint is
 * reported but does not fail the run, so the offline path stays usable.
 */
import { RpcProvider } from "starknet";
import { detectHistory } from "../src/core/detect";
import { loadFixture } from "../src/core/fixture";
import {
  computeChannelKey,
  computeNoteId,
  computeNullifier,
  decryptNoteAmount,
  encryptNoteAmount,
} from "../src/core/derive";
import { POOL_MAINNET, POOL_SEPOLIA } from "../src/utils/constants";
import ref from "../fixtures/cairo-reference-data.json";

const NETWORKS = [
  {
    name: "mainnet",
    pool: POOL_MAINNET,
    rpc: process.env.STARKNET_RPC_MAINNET ?? "https://api.cartridge.gg/x/starknet/mainnet",
  },
  {
    name: "sepolia",
    pool: POOL_SEPOLIA,
    rpc: process.env.STARKNET_RPC_SEPOLIA ?? "https://api.cartridge.gg/x/starknet/sepolia",
  },
];

let failed = false;

function ok(label: string, detail: string) {
  console.log(`  ok    ${label.padEnd(22)} ${detail}`);
}

function bad(label: string, detail: string, hard = true) {
  console.log(`  ${hard ? "FAIL" : "warn"}  ${label.padEnd(22)} ${detail}`);
  if (hard) failed = true;
}

async function checkNetwork(n: (typeof NETWORKS)[number]) {
  console.log(`\n${n.name}  pool ${n.pool}`);
  console.log(`  rpc   ${n.rpc}`);
  const provider = new RpcProvider({ nodeUrl: n.rpc });

  let reachable = true;
  try {
    await provider.getClassHashAt(n.pool);
  } catch (e: any) {
    bad("pool deployed", e?.message ?? String(e), false);
    reachable = false;
  }
  if (!reachable) return;

  try {
    const [version] = await provider.callContract({
      contractAddress: n.pool,
      entrypoint: "get_version",
      calldata: [],
    });
    // Version is a Cairo short string, e.g. 0x322e30 is "2.0".
    const text = Buffer.from(version.replace(/^0x/, ""), "hex").toString("utf8");
    ok("get_version", `${version} (${text})`);
  } catch (e: any) {
    bad("get_version", e?.message ?? String(e));
  }

  // An unwritten WriteOnce cell must read as zero rather than revert. Absence
  // has to be distinguishable from presence for a verifier with no key.
  try {
    const res = await provider.callContract({
      contractAddress: n.pool,
      entrypoint: "get_note",
      calldata: ["0x1"],
    });
    if (BigInt(res[0]) === 0n) ok("get_note (empty)", "reads 0x0 for an unwritten note");
    else bad("get_note (empty)", `expected 0x0, got ${res[0]}`);
  } catch (e: any) {
    bad("get_note", e?.message ?? String(e));
  }

  try {
    const res = await provider.callContract({
      contractAddress: n.pool,
      entrypoint: "nullifier_exists",
      calldata: ["0x1"],
    });
    ok("nullifier_exists", `answers ${res[0]}`);
  } catch (e: any) {
    bad("nullifier_exists", e?.message ?? String(e));
  }
}

function checkDerive() {
  console.log("\nderive vs Cairo reference vectors");
  const IN = ref.inputs;
  const OUT = ref.outputs;
  const hex = (v: bigint) => "0x" + v.toString(16);

  const cases: [string, string, string][] = [
    [
      "channel key",
      hex(
        computeChannelKey(IN.sender, IN.senderPrivateKey, IN.recipient, IN.recipientPublicKey),
      ),
      OUT.channelKey,
    ],
    ["note id", hex(computeNoteId(IN.channelKey, IN.token, IN.index)), OUT.noteId],
    [
      "nullifier",
      hex(computeNullifier(IN.channelKey, IN.token, IN.index, IN.senderPrivateKey)),
      OUT.nullifier,
    ],
  ];
  for (const [label, got, want] of cases) {
    if (got === want) ok(label, got);
    else bad(label, `got ${got}, want ${want}`);
  }

  const amount = BigInt(IN.amount);
  const packed = encryptNoteAmount(IN.channelKey, IN.token, IN.index, BigInt(IN.salt), amount);
  const back = decryptNoteAmount(packed, IN.channelKey, IN.token, IN.index);
  if (back.amount === amount) ok("amount round trip", `${amount} recovered from a packed note`);
  else bad("amount round trip", `got ${back.amount}, want ${amount}`);
}

function checkFixture() {
  console.log("\noffline fixture");
  const ids = detectHistory(loadFixture()).map((f) => f.id);
  if (ids.includes("rapid-inout-same-amount")) ok("fixture scores", ids.join(", "));
  else bad("fixture scores", `expected rapid-inout-same-amount, got [${ids.join(", ")}]`);
}

async function main() {
  for (const n of NETWORKS) await checkNetwork(n);
  checkDerive();
  checkFixture();
  console.log(failed ? "\ndoctor: FAILED" : "\ndoctor: all checks passed");
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
