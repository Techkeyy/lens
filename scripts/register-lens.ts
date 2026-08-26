/**
 * Register the Lens-derived viewing key with the STRK20 pool.
 *
 * ============================================================================
 * MAINNET EXECUTION BLOCKED. Dry run and investigation only.
 *
 * `--send` is not approved on mainnet until all three of these hold:
 *   1. the compatible prover revision is confirmed by the team;
 *   2. the prover request schema is confirmed against that revision;
 *   3. this file's transaction construction has been differential-tested
 *      against the exact compatible upstream SDK implementation.
 *
 * Why the caution: this reproduces protocol behaviour that the official SDK
 * owns. Action compilation, virtual transaction construction, transaction
 * hashing, proof inputs, proof facts and calldata encoding are all
 * version-specific, and a subtle mismatch spends a real fee to produce an
 * unusable registration. Reaching the prover boundary in a dry run is evidence
 * that the plumbing runs, not that it is correct.
 *
 * See scripts/differential-register.ts for the comparison harness.
 * ============================================================================
 *
 *   npx tsx scripts/register-lens.ts                 dry run, the default
 *   npx tsx scripts/register-lens.ts --send          broadcasts
 *   npx tsx scripts/register-lens.ts --sepolia       against Sepolia instead
 *
 * Requires PROVER_URL. Everything else is derived or read from chain.
 *
 * WHY THIS SCRIPT EXISTS WITHOUT THE SDK
 * --------------------------------------
 * The official Privacy SDK is not installable from here: it is absent from
 * npmjs and GitHub Packages answers 401. So this reproduces the two phases the
 * SDK performs, using the pool's own on-chain ABI to encode calldata rather
 * than hand-rolling the Cairo enum layout.
 *
 * PHASE 1, off chain. A virtual INVOKE v3 is built whose sender is the pool and
 * whose single call is `pool.compile_actions(user_addr, user_private_key,
 * client_actions)`. `__validate__` requires a zero tip and zero
 * max_price_per_unit on every resource, so it can never be a real transaction.
 * The Lens account signs it. The prover executes it and returns proof facts
 * plus the compiled server actions.
 *
 * PHASE 2, on chain. A real INVOKE calls `apply_actions(server_actions, None)`
 * carrying those proof facts. `None` is required, not optional: the pool
 * asserts `screening.is_none()` when no deposit is present, and registration
 * has no deposit.
 *
 * SECRETS
 * -------
 * The viewing key is derived in memory from a key in the gitignored .env.local.
 * It is never printed, logged or written. It does travel to the prover, because
 * the protocol puts it in the proved transaction's calldata, which is exactly
 * why PROVER_URL must point at infrastructure we operate on mainnet. On Sepolia
 * a hosted prover is acceptable with a disposable key.
 */
import { existsSync, readFileSync } from "node:fs";
import { Account, CairoOption, CairoOptionVariant, CallData, RpcProvider, constants, num } from "starknet";
import { NETWORKS, type NetworkConfig } from "../src/utils/networks";
import { deriveViewingKeyFromPrivateKey, publicViewingKey } from "../src/core/session";
import {
  buildProofInvocation,
  getDefaultProofDetails,
  serializeClientActions,
} from "./lib/register-invocation";
import {
  EXPECTED_VIRTUAL_PROGRAM_HASH,
  readLiveProgramHash,
} from "./lib/live-program-hash";

const SEPOLIA = process.argv.includes("--sepolia");
const SEND = process.argv.includes("--send");
const NET: NetworkConfig = SEPOLIA ? NETWORKS.sepolia : NETWORKS.mainnet;
const PROVER_URL = process.env.PROVER_URL;
const ENV_FILE = ".env.local";

function fail(msg: string): never {
  console.error(`\nREFUSED: ${msg}`);
  process.exit(1);
}

function env(name: string): string {
  if (!existsSync(ENV_FILE)) fail(`${ENV_FILE} not found. Secrets are not in the repository by design.`);
  const line = readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim();
  if (!value) fail(`No ${name} in ${ENV_FILE}.`);
  return value;
}

/**
 * A prover URL can carry an API key in a query string or in userinfo, so only
 * the host is ever logged. Never print PROVER_URL itself.
 */
function proverHost(): string {
  try {
    const u = new URL(PROVER_URL!);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "unparseable URL, not printed";
  }
}

/**
 * Ask the prover what it is before asking it to do anything. Reported in the
 * pre-flight so the revision in play is on the record next to the transaction
 * it produced.
 */
async function proverSpecVersion(): Promise<string> {
  try {
    const res = await fetch(PROVER_URL!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_specVersion", params: [] }),
    });
    const body = (await res.json()) as { result?: string; error?: { message?: string } };
    return body.result ?? `no version reported (${body.error?.message ?? `HTTP ${res.status}`})`;
  } catch (e) {
    return `unreachable (${(e as Error).message.slice(0, 60)})`;
  }
}

/** JSON-RPC to the proving service. Shape from types-js proving-api. */
async function prove(transaction: unknown, blockNumber: number) {
  const res = await fetch(PROVER_URL!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_proveTransaction",
      params: { block_id: { block_number: blockNumber }, transaction },
    }),
  });
  if (!res.ok) fail(`Proving service HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    result?: { proof: string; proof_facts: string[]; l2_to_l1_messages?: unknown[] };
    error?: { code: number; message: string; data?: string };
  };
  if (body.error) fail(`Proving service error ${body.error.code}: ${body.error.message} ${body.error.data ?? ""}`);
  if (!body.result?.proof_facts?.length) fail("Proving service returned no proof facts.");
  return body.result;
}

async function main() {
  if (!PROVER_URL) {
    fail(
      "PROVER_URL is not set. This is the one unresolved parameter.\n" +
        "         Mainnet: it must be a prover we operate, because the protocol sends\n" +
        "         the viewing key to it. Sepolia: a hosted prover is acceptable with a\n" +
        "         disposable key. See docs/PROVER_PLAN.md.",
    );
  }

  const provider = new RpcProvider({ nodeUrl: NET.rpc });
  const chainId = await provider.getChainId();
  const expected = SEPOLIA ? constants.StarknetChainId.SN_SEPOLIA : constants.StarknetChainId.SN_MAIN;
  if (chainId !== expected) fail(`Chain is ${chainId}, expected ${expected}.`);

  const address = env(SEPOLIA ? "SEPOLIA_ADDRESS" : "MAINNET_ADDRESS");
  const privateKey = env(SEPOLIA ? "SEPOLIA_PRIVATE_KEY" : "MAINNET_PRIVATE_KEY");
  const account = new Account({ provider, address, signer: privateKey });

  // --- refuse to re-register -------------------------------------------------
  const existing = await provider.callContract({
    contractAddress: NET.pool,
    entrypoint: "get_public_key",
    calldata: [address],
  });
  if (BigInt(existing[0]) !== 0n) {
    fail(
      `Already registered with public key ${existing[0]}.\n` +
        "         SetViewingKey is write-once, so this cannot be changed.",
    );
  }

  // --- the key. Derived here, never printed. ---------------------------------
  const viewingKey = deriveViewingKeyFromPrivateKey(privateKey, NET.chainId, NET.pool);
  const expectedPublic = publicViewingKey(viewingKey);

  // --- phase 1: the virtual transaction --------------------------------------
  // Built by scripts/lib/register-invocation.ts, which mirrors the upstream
  // SDK's ProofInvocationFactory and is proven field-for-field identical to it
  // by scripts/differential-register.ts. Do not inline a variation here.
  const cls = (await provider.getClassAt(NET.pool)) as unknown as { abi: unknown };
  const abi = typeof cls.abi === "string" ? JSON.parse(cls.abi) : cls.abi;

  const cairoActions = serializeClientActions([
    { type: "SetViewingKey", input: { random: BigInt(Date.now()) * 1_000_003n } },
  ]);

  const { invocation: virtualTx } = await buildProofInvocation({
    abi,
    poolAddress: NET.pool,
    userAddress: address,
    viewingKey,
    cairoActions,
    signer: account.signer,
    details: getDefaultProofDetails(NET.chainId),
  });

  const block = await provider.getBlockNumber();
  const poolClass = await provider.getClassHashAt(NET.pool);
  const spec = await proverSpecVersion();
  const gateOpen = SEPOLIA || !!process.env.LENS_REGISTER_APPROVED;

  const row = (k: string, v: string) => console.log(`  ${k.padEnd(22)}${v}`);
  console.log("PRE-FLIGHT");
  row("chain", `${NET.label}  ${chainId}`);
  row("pool", NET.pool);
  row("pool class hash", poolClass);
  row("lens account", address);
  row("public viewing key", num.toHex(expectedPublic));
  row("viewing key", "derived in memory, never printed");
  row("currently on chain", "0, not registered");
  row("prover host", proverHost());
  row("prover spec version", spec);
  row("proving block", String(block));
  row("client actions", "SetViewingKey");
  row("screening", "None, required for a non-deposit action");
  row("expected fee", "6 STRK pool fee, plus roughly 2.9 STRK of gas");
  row("approval gate", gateOpen ? "OPEN" : "CLOSED, LENS_REGISTER_APPROVED is not set");
  row("mode", SEND ? "SEND" : "DRY RUN");

  // Which proof program is the sequencer accepting right now? The pool ignores
  // virtual_program_hash, so this is the sequencer's answer, not the pool's,
  // and it is the thing that decides whether a self-hosted prover is usable.
  const live = await readLiveProgramHash(provider, NET.pool);
  if (!live) {
    row("live program hash", "could not be sampled, treat compatibility as unknown");
  } else {
    row("live program hash", `${live.virtualProgramHash}  (${live.sampled} txs, block ~${live.fromBlock})`);
    row("live markers", `${live.programVariant} / ${live.osOutputVersion}`);
    row(
      "matches expected",
      live.virtualProgramHash === EXPECTED_VIRTUAL_PROGRAM_HASH
        ? "YES"
        : `NO. expected ${EXPECTED_VIRTUAL_PROGRAM_HASH}`,
    );
    if (!live.agreed) row("WARNING", "sampled transactions disagree; the sequencer may be mid-rotation");
  }

  if (!SEND) {
    console.log("\nDRY RUN: nothing was proved and nothing was broadcast.");
    console.log("--send is not approved on mainnet yet. See the header of this file.");
    return;
  }

  if (!SEPOLIA && !process.env.LENS_REGISTER_APPROVED) {
    fail(
      "Mainnet --send is gated.\n" +
        "         This construction has not been differential-tested against the\n" +
        "         upstream SDK, and a subtle mismatch spends a real fee to produce an\n" +
        "         unusable registration. Set LENS_REGISTER_APPROVED=1 only after the\n" +
        "         three conditions in this file's header are met.",
    );
  }

  console.log("\nproving…");
  const proof = await prove(virtualTx, block);
  console.log(`proof facts         ${proof.proof_facts.length} felts`);

  // --- phase 2: the real transaction ----------------------------------------
  // The prover's output is [class_hash, ...serialized server actions]; the
  // class hash is dropped and the rest becomes apply_actions calldata, with
  // `None` appended for screening.
  const output = (proof as unknown as { output?: string[] }).output;
  if (!output?.length) {
    fail(
      "The prover returned no `output` array, so the server actions could not be\n" +
        "         recovered. This is the step that most needs checking against the\n" +
        "         prover version the team confirms.",
    );
  }
  const serverActions = output.slice(1);
  const screeningNone = CallData.compile([new CairoOption(CairoOptionVariant.None)]);

  console.log("submitting apply_actions…");
  const { transaction_hash } = await account.execute(
    [
      {
        contractAddress: NET.pool,
        entrypoint: "apply_actions",
        calldata: [...serverActions, ...screeningNone],
      },
    ],
    { proofFacts: proof.proof_facts } as never,
  );
  console.log(`tx                  ${transaction_hash}`);
  const receipt = (await provider.waitForTransaction(transaction_hash)) as unknown as {
    execution_status?: string;
    block_number?: number;
  };
  console.log(`status              ${receipt.execution_status} block ${receipt.block_number}`);

  const after = await provider.callContract({
    contractAddress: NET.pool,
    entrypoint: "get_public_key",
    calldata: [address],
  });
  const matches = BigInt(after[0]) === expectedPublic;
  console.log(`get_public_key      ${after[0]}`);
  console.log(`MATCHES LENS KEY    ${matches ? "YES" : "NO"}`);
  if (!matches) {
    console.error("\nSTOP: the pool did not record the key Lens derives. Do not continue.");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\nFAILED: ${e?.message ?? e}`);
  process.exit(1);
});
