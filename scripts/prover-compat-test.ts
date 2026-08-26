/**
 * Does a self-hosted prover produce a proof mainnet will accept?
 *
 *   PROVER_URL=http://127.0.0.1:3000 npx tsx scripts/prover-compat-test.ts
 *
 * THIS SCRIPT CANNOT BROADCAST. There is no `account.execute` in it, no
 * `apply_actions` call, and no `--send` flag. It builds a registration, asks the
 * prover to prove it, and checks the answer. That is the whole job.
 *
 * WHAT IT USES
 * ------------
 * The throwaway account from `scripts/throwaway-account.ts`, and a viewing key
 * generated fresh for this run. No Lens production key of any kind is loaded:
 * this file never opens `.env.local`.
 *
 * The throwaway must be deployed, because the pool calls `is_valid_signature`
 * on `user_addr` while executing the virtual transaction.
 *
 * WHY A THROWAWAY VIEWING KEY IS SAFE HERE AND THE REAL ONE WOULD NOT BE
 * ---------------------------------------------------------------------
 * The protocol puts the viewing key in the proved transaction's calldata, so
 * the prover sees it. That is exactly why mainnet proving must run on our own
 * machine. For a compatibility test the key is disposable, the account is
 * disposable, and neither is ever used again.
 *
 * SECRETS
 * -------
 * Neither the throwaway account key nor the disposable viewing key is printed.
 * The prover URL is reported host-only, because a URL can carry a token.
 */
import { existsSync, readFileSync } from "node:fs";
import { Account, RpcProvider, ec, hash, num } from "starknet";
import { NETWORKS } from "../src/utils/networks";
import {
  buildProofInvocation,
  getDefaultProofDetails,
  serializeClientActions,
} from "./lib/register-invocation";
import { EXPECTED_VIRTUAL_PROGRAM_HASH, readLiveProgramHash } from "./lib/live-program-hash";

const ENV_FILE = ".env.throwaway.local";
const PROVER_URL = process.env.PROVER_URL;
const NET = NETWORKS.mainnet;

/** The pool class this stack was verified against: PRIVACY-0.14.3-RC.3. */
const EXPECTED_POOL_CLASS = "0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d";

function fail(message: string): never {
  console.error(`\nSTOP: ${message}`);
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

function proverHost(): string {
  try {
    const u = new URL(PROVER_URL!);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "unparseable, not printed";
  }
}

/**
 * A canonical disposable viewing key. The pool asserts `key < ORDER / 2`, so a
 * raw random felt is not good enough.
 */
function disposableViewingKey(): bigint {
  const order = ec.starkCurve.CURVE.n;
  for (;;) {
    const candidate = BigInt(ec.starkCurve.utils.randomPrivateKey ? num.toHex(BigInt(`0x${Buffer.from(ec.starkCurve.utils.randomPrivateKey()).toString("hex")}`)) : "0x1") % order;
    if (candidate > 0n && candidate < order / 2n) return candidate;
  }
}

async function main() {
  if (!PROVER_URL) fail("PROVER_URL is not set. Point it at the tunnelled prover, e.g. http://127.0.0.1:3000");

  const provider = new RpcProvider({ nodeUrl: NET.rpc });
  const row = (k: string, v: string) => console.log(`  ${k.padEnd(24)}${v}`);

  console.log("PRE-FLIGHT GATES");

  // 1. chain
  const chainId = await provider.getChainId();
  if (chainId !== "0x534e5f4d41494e") fail(`Chain is ${chainId}, expected mainnet.`);
  row("chain", `Starknet mainnet ${chainId}`);

  // 2. pool class still the revision this stack was verified against
  const poolClass = await provider.getClassHashAt(NET.pool);
  row("pool class", poolClass);
  if (BigInt(poolClass) !== BigInt(EXPECTED_POOL_CLASS)) {
    fail(`Pool class moved. Expected ${EXPECTED_POOL_CLASS} (PRIVACY-0.14.3-RC.3).`);
  }
  row("pool source", "PRIVACY-0.14.3-RC.3, class hash reproduced from source");

  // 3. the program the sequencer is accepting right now
  const live = await readLiveProgramHash(provider, NET.pool);
  if (!live) fail("Could not sample the live accepted program hash. Do not test against an unknown target.");
  row("live program hash", live.virtualProgramHash);
  row("sampled", `${live.sampled} transactions, unanimous: ${live.agreed ? "yes" : "NO"}`);
  if (!live.agreed) fail("Sampled transactions disagree. The sequencer may be mid-rotation.");
  if (live.virtualProgramHash !== EXPECTED_VIRTUAL_PROGRAM_HASH) {
    fail(`Live program hash moved from ${EXPECTED_VIRTUAL_PROGRAM_HASH}. Re-map before testing.`);
  }
  row("matches expected", "YES");

  // 4. throwaway actor, and nothing from production
  const address = readEnv("THROWAWAY_ADDRESS");
  const privateKey = readEnv("THROWAWAY_PRIVATE_KEY");
  if (!address || !privateKey) fail(`No throwaway account. Run scripts/throwaway-account.ts --new first.`);
  try {
    await provider.getClassHashAt(address);
  } catch {
    fail(`Throwaway ${address} is not deployed. The pool calls is_valid_signature on it.`);
  }
  row("actor", `${address} (throwaway, deployed)`);
  row("viewing key", "disposable, generated for this run, not printed");
  row("production keys", "none loaded; this script never opens .env.local");

  // 5. prover identity
  row("prover host", proverHost());
  let spec = "unreachable";
  try {
    const res = await fetch(PROVER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_specVersion", params: [] }),
    });
    const body = (await res.json()) as { result?: string };
    spec = body.result ?? "no version reported";
  } catch (e) {
    fail(`Prover unreachable: ${(e as Error).message.slice(0, 120)}`);
  }
  row("prover spec", spec);

  const block = await provider.getBlockNumber();
  row("proving block", String(block));

  // --- build, exactly as the verified module does --------------------------
  const cls = (await provider.getClassAt(NET.pool)) as unknown as { abi: unknown };
  const abi = typeof cls.abi === "string" ? JSON.parse(cls.abi) : cls.abi;
  const account = new Account({ provider, address, signer: privateKey });

  const { invocation } = await buildProofInvocation({
    abi,
    poolAddress: NET.pool,
    userAddress: address,
    viewingKey: disposableViewingKey(),
    cairoActions: serializeClientActions([
      { type: "SetViewingKey", input: { random: BigInt(Date.now()) * 1_000_003n } },
    ]),
    signer: account.signer,
    details: getDefaultProofDetails(NET.chainId),
  });

  console.log("\nPROVING");
  const started = Date.now();
  const res = await fetch(PROVER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_proveTransaction",
      params: { block_id: { block_number: block }, transaction: invocation },
    }),
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const body = (await res.json()) as {
    result?: { proof?: string; proof_facts?: string[]; l2_to_l1_messages?: unknown[]; output?: string[] };
    error?: { code: number; message: string; data?: string };
  };

  row("http status", String(res.status));
  row("duration", `${elapsed}s`);

  if (body.error) {
    fail(
      `Prover error ${body.error.code}: ${body.error.message} ${body.error.data ?? ""}\n` +
        "      PROOF GENERATED: NO. This candidate is incompatible. Do not try another automatically.",
    );
  }
  const facts = body.result?.proof_facts;
  if (!facts?.length) fail("Prover returned no proof facts. PROOF GENERATED: NO.");

  console.log("\nRESULT");
  row("proof generated", "YES");
  row("proof bytes", String(body.result?.proof?.length ?? 0));
  row("proof facts", `${facts.length} felts`);
  row("output felts", String(body.result?.output?.length ?? 0));

  const short = (h: string) => {
    try {
      const t = Buffer.from(h.slice(2).padStart(h.slice(2).length + (h.slice(2).length % 2), "0"), "hex").toString();
      return /^[\x20-\x7e]+$/.test(t) ? `  "${t}"` : "";
    } catch {
      return "";
    }
  };
  const names = ["proof_version", "program_variant", "virtual_program_hash", "starknet_os_output_version"];
  for (let i = 0; i < Math.min(4, facts.length); i += 1) row(names[i], `${facts[i]}${short(facts[i])}`);

  console.log("\nPOST-PROOF GATE");
  const produced = facts[2];
  row("produced program", produced);
  row("expected program", EXPECTED_VIRTUAL_PROGRAM_HASH);
  const match = produced === EXPECTED_VIRTUAL_PROGRAM_HASH;
  row("MATCH", match ? "YES" : "NO");

  if (!match) {
    fail("This prover produces a program mainnet does not accept. MAINNET PROVER STACK VALIDATED: NO.");
  }
  if (facts[1] !== num.toHex(BigInt("0x" + Buffer.from("VIRTUAL_SNOS").toString("hex")))) {
    console.log("  note                 program_variant differs from the literal VIRTUAL_SNOS encoding, check it");
  }

  console.log("\nMAINNET PROVER STACK VALIDATED: YES");
  console.log("Nothing was broadcast. This script has no submission path.");
  console.log(`The proof expires in ~450 blocks from ${block} and is not being kept.`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e?.message ?? e}`);
  process.exit(1);
});
