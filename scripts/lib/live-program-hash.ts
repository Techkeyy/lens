/**
 * What virtual-OS program is the live pool actually accepting right now?
 *
 * The pool's `validate_proof` does **not** check `virtual_program_hash`: it
 * destructures the field and discards it, asserting only `program_variant`,
 * `starknet_os_output_version`, block freshness and the message hash. The real
 * verifier is the sequencer, which decides which proof programs it will accept
 * and populates `tx_info.proof_facts` only for proofs it verified.
 *
 * So the compatibility question is not "which pool class is deployed", it is
 * "which program does the sequencer accept today". That is readable from any
 * recent successful pool transaction, and it is the only authoritative answer.
 *
 * `proof_facts` is not serialized by `starknet_getTransactionByHash` on any RPC
 * tested. The feeder gateway does return it, which is why this reads there.
 *
 * ProofFacts layout, from `packages/privacy/src/utils.cairo`:
 *   [0] proof_version               "PROOF1"
 *   [1] program_variant             "VIRTUAL_SNOS"
 *   [2] virtual_program_hash        <- the one that matters here
 *   [3] starknet_os_output_version  "VIRTUAL_SNOS0"
 *   [4] base_block_number
 *   [5] base_block_hash
 *   [6] starknet_os_config_hash
 *   [7] message_to_l1_hashes length
 *   [8...] message hashes
 */
import { RpcProvider, hash } from "starknet";

const FEEDER = "https://feeder.alpha-mainnet.starknet.io/feeder_gateway/get_transaction";

export type LiveProgram = {
  virtualProgramHash: string;
  programVariant: string;
  osOutputVersion: string;
  sampled: number;
  agreed: boolean;
  fromBlock: number;
};

/** Decode a short-string felt, for the human-readable marker fields. */
function felstr(felt: string): string {
  try {
    const hex = felt.slice(2);
    return Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex").toString();
  } catch {
    return felt;
  }
}

/**
 * Sample recent successful pool transactions and report the program hash they
 * carry. Reads only, and touches no key.
 *
 * `agreed` is false if the sample is not unanimous, which would mean the
 * sequencer is mid-rotation and nothing should be spent until it settles.
 */
export async function readLiveProgramHash(
  provider: RpcProvider,
  poolAddress: string,
  opts: { sample?: number; lookback?: number } = {},
): Promise<LiveProgram | undefined> {
  const sample = opts.sample ?? 6;
  const lookback = opts.lookback ?? 12_000;
  const latest = await provider.getBlockNumber();

  const hashes: string[] = [];
  for (const event of ["NoteUsed", "ViewingKeySet"]) {
    if (hashes.length >= sample) break;
    try {
      const res = (await provider.getEvents({
        address: poolAddress,
        keys: [[hash.getSelectorFromName(event)]],
        from_block: { block_number: Math.max(0, latest - lookback) },
        to_block: { block_number: latest },
        chunk_size: 25,
      } as never)) as { events: Array<{ transaction_hash: string }> };
      for (const e of res.events) if (!hashes.includes(e.transaction_hash)) hashes.push(e.transaction_hash);
    } catch {
      /* try the next event type */
    }
  }
  if (hashes.length === 0) return undefined;

  const seen = new Map<string, number>();
  let variant = "";
  let osVersion = "";
  let fromBlock = 0;
  let sampled = 0;

  for (const tx of hashes.slice(0, sample)) {
    try {
      const res = await fetch(`${FEEDER}?transactionHash=${tx}`);
      const body = (await res.json()) as {
        transaction?: { proof_facts?: string[] };
        block_number?: number;
      };
      const facts = body.transaction?.proof_facts;
      if (!facts || facts.length < 4) continue;
      sampled += 1;
      seen.set(facts[2], (seen.get(facts[2]) ?? 0) + 1);
      variant = felstr(facts[1]);
      osVersion = felstr(facts[3]);
      fromBlock = body.block_number ?? fromBlock;
    } catch {
      /* a single unreachable sample is not fatal */
    }
  }
  if (sampled === 0) return undefined;

  const [top] = [...seen.entries()].sort((a, b) => b[1] - a[1]);
  return {
    virtualProgramHash: top[0],
    programVariant: variant,
    osOutputVersion: osVersion,
    sampled,
    agreed: seen.size === 1,
    fromBlock,
  };
}

/**
 * The program hash our chosen prover image is expected to produce.
 *
 * Established, not assumed: every sampled live pool transaction carries this
 * value; `starknet-innovation/snip-36-prover-backend` pins it as
 * `EXPECTED_VIRTUAL_OS_PROGRAM_HASH` produced by sequencer commit
 * `e6b6fd2e9932909107833579e5b6efd6c75fa0af`; and
 * `transaction-prover:PRIVACY-0.14.3-RC.2` carries exactly that commit in its
 * `org.opencontainers.image.revision` label.
 */
export const EXPECTED_VIRTUAL_PROGRAM_HASH =
  "0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1";
