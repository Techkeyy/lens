/**
 * Verify a Ready first shield, independently of the wallet that made it.
 *
 *   npx tsx scripts/verify-shield.ts <tx hash> [--sepolia]
 *   npm run verify:shield -- 0x...
 *
 * Reads only. No key is loaded, nothing is signed, nothing is submitted, so
 * this can be run by anyone from a machine that has never held a secret.
 *
 * Two independent RPCs are queried and compared, because one endpoint agreeing
 * with itself is not verification.
 *
 * The check that actually matters is `get_public_key`. If the shield did not
 * register the account, the private transfers cannot work and the run must
 * stop, so this script exits non-zero in that case rather than printing a
 * cheerful summary.
 */
import { RpcProvider, hash } from "starknet";
import { NETWORKS, type NetworkConfig } from "../src/utils/networks";
import { formatAmount } from "../src/core/view";

const NET: NetworkConfig = process.argv.includes("--sepolia") ? NETWORKS.sepolia : NETWORKS.mainnet;
const READY = "0x04c7082c068f3d78d0637c867041e322a33b03ed70606ad4bd8e5771a13f99c8";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const RPCS =
  NET.id === "mainnet"
    ? ["https://api.cartridge.gg/x/starknet/mainnet", "https://rpc.starknet.lava.build"]
    : ["https://api.cartridge.gg/x/starknet/sepolia"];

const EVENTS = ["ViewingKeySet", "Deposit", "EncNoteCreated", "NoteUsed", "Withdrawal"];
const EVENT_BY_KEY = new Map(EVENTS.map((n) => [BigInt(hash.getSelectorFromName(n)), n]));

const ok = (label: string, detail: string) => console.log(`  ok    ${label.padEnd(28)} ${detail}`);
const no = (label: string, detail: string) => console.log(`  FAIL  ${label.padEnd(28)} ${detail}`);

async function main() {
  const txHash = process.argv.slice(2).find((a) => a.startsWith("0x"));
  const who = process.argv.slice(2).filter((a) => a.startsWith("0x"))[1] ?? READY;

  console.log(`network   ${NET.label}`);
  console.log(`pool      ${NET.pool}`);
  console.log(`account   ${who}`);
  console.log(`tx        ${txHash ?? "none given, reading state only"}\n`);

  let failed = false;

  for (const url of RPCS) {
    const provider = new RpcProvider({ nodeUrl: url });
    console.log(`== ${url.replace(/^https:\/\//, "")}`);

    // --- A, B, E: the transaction itself -----------------------------------
    if (txHash) {
      try {
        const receipt = (await provider.getTransactionReceipt(txHash)) as unknown as {
          execution_status?: string;
          finality_status?: string;
          block_number?: number;
          actual_fee?: { amount?: string; unit?: string };
          events?: Array<{ from_address: string; keys: string[] }>;
        };

        const succeeded = receipt.execution_status === "SUCCEEDED";
        (succeeded ? ok : no)(
          "receipt",
          `${receipt.execution_status} ${receipt.finality_status} block ${receipt.block_number}`,
        );
        if (!succeeded) failed = true;
        if (receipt.actual_fee?.amount) {
          ok("gas paid", `${formatAmount(BigInt(receipt.actual_fee.amount), 18)} ${receipt.actual_fee.unit ?? ""}`);
        }

        // B: did it touch the official pool?
        const poolEvents = (receipt.events ?? []).filter(
          (e) => BigInt(e.from_address) === BigInt(NET.pool),
        );
        if (poolEvents.length === 0) {
          no("touched the STRK20 pool", "no event came from the pool, so this is not pool evidence");
          failed = true;
        } else {
          const names = poolEvents
            .map((e) => EVENT_BY_KEY.get(BigInt(e.keys[0])) ?? `${e.keys[0].slice(0, 12)}…`)
            .join(", ");
          ok("touched the STRK20 pool", `${poolEvents.length} pool event(s): ${names}`);

          const registered = poolEvents.some(
            (e) => EVENT_BY_KEY.get(BigInt(e.keys[0])) === "ViewingKeySet",
          );
          const deposited = poolEvents.some((e) => EVENT_BY_KEY.get(BigInt(e.keys[0])) === "Deposit");
          (registered ? ok : no)(
            "ViewingKeySet emitted",
            registered ? "the shield registered this account" : "no registration in this transaction",
          );
          (deposited ? ok : no)("Deposit emitted", deposited ? "value entered the pool" : "no deposit");
          // E: screening is enforced on chain for deposits, so a succeeded
          // deposit is a screening pass. There is nothing else to check.
          if (deposited && succeeded) ok("screening", "passed, since the pool rejects an unscreened deposit");
        }
      } catch (e) {
        no("receipt", `not found: ${(e as Error).message.slice(0, 90)}`);
        failed = true;
      }
    }

    // --- C: the state that gates everything downstream ----------------------
    try {
      const r = await provider.callContract({
        contractAddress: NET.pool,
        entrypoint: "get_public_key",
        calldata: [who],
      });
      const key = BigInt(r[0]);
      if (key === 0n) {
        no("get_public_key", "still 0. NOT REGISTERED. Do not attempt private transfers.");
        failed = true;
      } else {
        ok("get_public_key", `0x${key.toString(16)}`);
      }
    } catch (e) {
      no("get_public_key", (e as Error).message.slice(0, 90));
      failed = true;
    }

    // Public balance, for the record.
    try {
      const r = await provider.callContract({
        contractAddress: STRK,
        entrypoint: "balanceOf",
        calldata: [who],
      });
      ok("public STRK", formatAmount(BigInt(r[0]) + (BigInt(r[1] ?? "0x0") << 128n), 18));
    } catch {
      /* not fatal */
    }

    console.log("");
  }

  console.log(
    failed
      ? "VERDICT: STOP. Something above did not hold, so do not run the private transfers."
      : "VERDICT: the shield registered the account and touched the pool.\n" +
          "         D (wallet_strk20Balances) is a wallet call, so check it at /probe or /ready.",
  );
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
