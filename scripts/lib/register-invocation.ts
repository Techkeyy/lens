/**
 * Build the proof invocation for a STRK20 registration.
 *
 * This mirrors `sdk/src/internal/proof-invocation-factory.ts` at
 * `PRIVACY-0.14.3-RC.3`, commit `efc61cbbdab5b714b5cf915f9735d88948e2ea82`,
 * which is the revision deployed on mainnet. That file is byte-identical
 * between RC.2 and RC.3; `client-actions.ts` is not, and the difference
 * matters. Originally written against RC.2, commit `9bfeb8dd…`,
 * deliberately and line for line where it matters. It is not an independent
 * design, and it should not become one: `scripts/differential-register.ts`
 * compares the two field by field against the real upstream source, and any
 * divergence is a bug here rather than a variation.
 *
 * Three details were wrong in the first hand-written version, and each would
 * have cost a real fee to discover:
 *
 *   1. The nonce is a hardcoded 0, not the pool's live nonce. Upstream is
 *      explicit about this: "Hardcoded nonce for proof invocations (no chain
 *      fetch)." The virtual transaction is never sequenced, so a real nonce is
 *      not only unnecessary, it is a different transaction.
 *   2. `l1_gas` and `l1_data_gas` carry `max_amount: 1n`, not `0n`. Only the
 *      prices are zero, which is what `__validate__` actually asserts.
 *   3. The signature comes from `signer.signTransaction` with `walletAddress`
 *      set to the pool, not from hand-hashing the transaction. starknet.js
 *      owns the V3 hash layout, including how proof facts fold into it.
 */
import {
  CairoCustomEnum,
  CallData,
  ETransactionVersion,
  hash,
  stark,
  type SignerInterface,
  type V3InvocationsSignerDetails,
} from "starknet";

/**
 * Mirrors upstream `CLIENT_ACTION_TYPES` at **RC.3**, which is the revision
 * actually deployed on mainnet: building the pool from source at
 * `PRIVACY-0.14.3-RC.3` reproduces the live class hash `0x67dddd89…b554d`
 * exactly.
 *
 * The order is the Cairo enum's variant order and must not be rearranged.
 * RC.3 appends a tenth variant, `ComputeAndInvoke`, which RC.2 does not have,
 * and the live pool's own ABI carries all ten. Nine entries here would be a
 * quiet mismatch against the deployed contract.
 */
export const CLIENT_ACTION_TYPES = [
  "SetViewingKey",
  "OpenChannel",
  "OpenSubchannel",
  "CreateEncNote",
  "CreateOpenNote",
  "Deposit",
  "UseNote",
  "Withdraw",
  "InvokeExternal",
  "ComputeAndInvoke",
] as const;

export type ClientAction = { type: (typeof CLIENT_ACTION_TYPES)[number]; input: unknown };

/**
 * Mirrors upstream `toCairoEnum`.
 *
 * Every variant key is present and only the active one is defined. Building the
 * enum with just the active key, which is the obvious thing to write, leaves
 * starknet.js to infer the variant index from the object's own keys rather than
 * from the Cairo variant order. That happens to be right for `SetViewingKey`,
 * which is index 0, and wrong for every other action.
 */
export function serializeClientActions(actions: ClientAction[]): CairoCustomEnum[] {
  return actions.map((action) => {
    const variants: Record<string, unknown> = {};
    for (const variant of CLIENT_ACTION_TYPES) {
      variants[variant] = variant === action.type ? action.input : undefined;
    }
    return new CairoCustomEnum(variants);
  });
}

/** Upstream `DEFAULT_L2_GAS_MAX_AMOUNT`. */
export const DEFAULT_L2_GAS_MAX_AMOUNT = 100_000_000n;

/** Upstream `PROOF_INVOCATION_NONCE`. Hardcoded, never fetched. */
export const PROOF_INVOCATION_NONCE = 0n;

export type ProofDetails = ReturnType<typeof getDefaultProofDetails>;

/** Mirrors upstream `getDefaultProofDetails`. */
export function getDefaultProofDetails(chainId: string) {
  return {
    versions: [ETransactionVersion.V3],
    nonce: PROOF_INVOCATION_NONCE,
    skipValidate: true,
    resourceBounds: {
      l1_gas: { max_amount: 1n, max_price_per_unit: 0n },
      l2_gas: { max_amount: DEFAULT_L2_GAS_MAX_AMOUNT, max_price_per_unit: 0n },
      l1_data_gas: { max_amount: 1n, max_price_per_unit: 0n },
    },
    tip: 0n,
    paymasterData: [] as string[],
    accountDeploymentData: [] as string[],
    nonceDataAvailabilityMode: "L1" as const,
    feeDataAvailabilityMode: "L1" as const,
    version: ETransactionVersion.V3,
    chainId,
  };
}

/**
 * Upstream's `toHex` normalizes through BigInt, so `0x0403...` becomes
 * `0x403...`. Passing an already-hex string straight through leaves the
 * zero-padded form and produces a different `sender_address` in the JSON sent
 * to the prover. The differential test caught exactly that.
 */
const toHex = (v: bigint | string | number): string => `0x${BigInt(v).toString(16)}`;

/**
 * Mirrors upstream `compileExecuteCalldata`:
 * `[array_len=1, to, selector, inner_len, ...inner]`.
 */
export function compileExecuteCalldata(
  abi: unknown,
  poolAddress: string,
  executeViewCalldata: string[],
): string[] {
  return new CallData(abi as never).compile("__execute__", [
    [
      {
        to: poolAddress,
        selector: hash.getSelectorFromName("compile_actions"),
        calldata: executeViewCalldata,
      },
    ],
  ]);
}

export type Invocation = {
  type: "INVOKE";
  sender_address: string;
  calldata: string[];
  signature: string[];
  nonce: string;
  resource_bounds: Record<string, { max_amount: string; max_price_per_unit: string }>;
  tip: string;
  paymaster_data: string[];
  account_deployment_data: string[];
  nonce_data_availability_mode: string;
  fee_data_availability_mode: string;
  version: string;
};

/**
 * Build the signed virtual transaction the prover is asked to prove.
 *
 * `cairoActions` must already be the serialized `CairoCustomEnum[]`, so that
 * the differential test can hand both implementations the identical value and
 * compare only what follows.
 */
export async function buildProofInvocation(params: {
  abi: unknown;
  poolAddress: string;
  userAddress: string;
  viewingKey: bigint;
  cairoActions: unknown[];
  signer: SignerInterface;
  details: ProofDetails;
}): Promise<{ invocation: Invocation; executeViewCalldata: string[] }> {
  const { abi, poolAddress, userAddress, viewingKey, cairoActions, signer, details } = params;
  const callDataCompiler = new CallData(abi as never);

  const executeViewCalldata = callDataCompiler.compile("compile_actions", [
    BigInt(userAddress),
    viewingKey,
    cairoActions,
  ]);
  const compiledCalldata = compileExecuteCalldata(abi, poolAddress, executeViewCalldata).map(toHex);

  const nonce = BigInt(details.nonce ?? PROOF_INVOCATION_NONCE);
  const detailsWithNonce = { ...details, nonce };

  // Upstream passes the *inner* calldata here, not the wrapped form, because
  // signTransaction wraps it again internally. Passing the wrapped calldata
  // would double-wrap and sign a different transaction.
  const signature = await signer.signTransaction(
    [{ contractAddress: poolAddress, entrypoint: "compile_actions", calldata: executeViewCalldata }],
    { walletAddress: poolAddress, cairoVersion: "1", ...detailsWithNonce } as unknown as V3InvocationsSignerDetails,
  );

  const rb = detailsWithNonce.resourceBounds;
  return {
    executeViewCalldata,
    invocation: {
      type: "INVOKE",
      sender_address: toHex(poolAddress),
      calldata: compiledCalldata,
      signature: stark.formatSignature(signature),
      nonce: toHex(nonce),
      resource_bounds: {
        l1_gas: {
          max_amount: toHex(rb.l1_gas.max_amount),
          max_price_per_unit: toHex(rb.l1_gas.max_price_per_unit),
        },
        l2_gas: {
          max_amount: toHex(rb.l2_gas.max_amount),
          max_price_per_unit: toHex(rb.l2_gas.max_price_per_unit),
        },
        l1_data_gas: {
          max_amount: toHex(rb.l1_data_gas.max_amount),
          max_price_per_unit: toHex(rb.l1_data_gas.max_price_per_unit),
        },
      },
      tip: toHex(detailsWithNonce.tip),
      paymaster_data: detailsWithNonce.paymasterData.map(toHex),
      account_deployment_data: detailsWithNonce.accountDeploymentData.map(toHex),
      nonce_data_availability_mode: detailsWithNonce.nonceDataAvailabilityMode,
      fee_data_availability_mode: detailsWithNonce.feeDataAvailabilityMode,
      version: "0x3",
    },
  };
}
