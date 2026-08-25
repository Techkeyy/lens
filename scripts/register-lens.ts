/**
 * Register the Lens-derived viewing key with the STRK20 pool.
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
import {
  Account,
  CairoCustomEnum,
  CairoOption,
  CairoOptionVariant,
  CallData,
  RpcProvider,
  ec,
  constants,
  hash,
  num,
  stark,
} from "starknet";
import { NETWORKS, type NetworkConfig } from "../src/utils/networks";
import { deriveViewingKeyFromPrivateKey, publicViewingKey } from "../src/core/session";

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
  // Encoded with the pool's own ABI so the ClientAction enum layout comes from
  // the chain rather than from a guess.
  const cls = (await provider.getClassAt(NET.pool)) as unknown as { abi: unknown };
  const abi = typeof cls.abi === "string" ? JSON.parse(cls.abi) : cls.abi;
  const poolCallData = new CallData(abi as never);

  const clientActions = [
    new CairoCustomEnum({ SetViewingKey: { random: num.toHex(BigInt(Date.now()) * 1_000_003n) } }),
  ];
  const compileCalldata = poolCallData.compile("compile_actions", {
    user_addr: address,
    user_private_key: num.toHex(viewingKey),
    client_actions: clientActions,
  });

  // `__validate__` rejects any non-zero price or tip, so the bounds are zero
  // except for an l2_gas allowance, which the prover permits.
  const details = stark.v3Details({});
  const bounds = {
    ...details.resourceBounds,
    l2_gas: { max_amount: 100_000_000n, max_price_per_unit: 0n },
  };
  const asRpcBounds = (b: typeof bounds) =>
    Object.fromEntries(
      Object.entries(b).map(([k, v]) => [
        k,
        { max_amount: num.toHex(v.max_amount), max_price_per_unit: num.toHex(v.max_price_per_unit) },
      ]),
    );

  const virtualCalldata = CallData.compile([
    "0x1",
    NET.pool,
    hash.getSelectorFromName("compile_actions"),
    num.toHex(compileCalldata.length),
    ...compileCalldata,
  ]);
  const poolNonce = await provider.getNonceForAddress(NET.pool);

  const virtualTx = {
    type: "INVOKE",
    version: "0x3",
    sender_address: NET.pool,
    calldata: virtualCalldata,
    signature: [] as string[],
    nonce: poolNonce,
    resource_bounds: asRpcBounds(bounds),
    tip: "0x0",
    paymaster_data: [],
    account_deployment_data: [],
    nonce_data_availability_mode: "L1",
    fee_data_availability_mode: "L1",
  };

  // The pool authenticates the user over this transaction hash.
  const txHash = hash.calculateInvokeTransactionHash({
    senderAddress: virtualTx.sender_address,
    version: virtualTx.version,
    compiledCalldata: virtualTx.calldata,
    chainId: chainId as constants.StarknetChainId,
    nonce: virtualTx.nonce,
    accountDeploymentData: [],
    nonceDataAvailabilityMode: stark.intDAM(details.nonceDataAvailabilityMode),
    feeDataAvailabilityMode: stark.intDAM(details.feeDataAvailabilityMode),
    resourceBounds: bounds,
    tip: details.tip,
    paymasterData: details.paymasterData,
  } as never);
  // The OZ account validates [r, s] over this hash, which is what
  // `is_valid_signature` checks inside `assert_valid_signature`.
  const sig = ec.starkCurve.sign(txHash as string, privateKey);
  virtualTx.signature = [num.toHex(sig.r), num.toHex(sig.s)];

  const block = await provider.getBlockNumber();

  console.log(`network             ${NET.label}`);
  console.log(`pool                ${NET.pool}`);
  console.log(`lens account        ${address}`);
  console.log(`viewing key         derived in memory, not printed`);
  console.log(`public viewing key  ${num.toHex(expectedPublic)}`);
  console.log(`currently on chain  0 (not registered)`);
  console.log(`prover              ${PROVER_URL}`);
  console.log(`proving block       ${block}`);
  console.log(`client actions      SetViewingKey`);
  console.log(`screening           None, required for a non-deposit action`);
  console.log(`pool fee            6 STRK, plus roughly 2.9 STRK of gas`);
  console.log(`mode                ${SEND ? "SEND" : "DRY RUN"}`);

  if (!SEND) {
    console.log("\nDRY RUN: nothing was proved and nothing was broadcast.");
    console.log("Re-run with --send once PROVER_URL is a prover you trust with the viewing key.");
    return;
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
