/**
 * Independently check the ETH recovery transfer.
 *
 *   npx tsx scripts/verify-recovery-eth.ts <tx hash>
 *   npm run recovery:verify -- <tx hash>
 *
 * Reads only. No key is loaded and nothing is signed, so this can be run by
 * anyone, including from a machine that has never seen the deployer key.
 *
 * Two independent RPCs are queried and compared, because one endpoint agreeing
 * with itself is not verification.
 */
import { RpcProvider } from "starknet";

const SOURCE = "0x47366fff6d7da5f313cf6a379f460c8544db248231a532e533afd588d801aca";
const DESTINATION = "0x04c7082c068f3d78d0637c867041e322a33b03ed70606ad4bd8e5771a13f99c8";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const RPCS = [
  "https://api.cartridge.gg/x/starknet/mainnet",
  "https://rpc.starknet.lava.build",
];

const fmt = (v: bigint) => (Number(v) / 1e18).toString();

async function balanceOf(provider: RpcProvider, token: string, who: string) {
  const r = await provider.callContract({
    contractAddress: token,
    entrypoint: "balanceOf",
    calldata: [who],
  });
  return BigInt(r[0]) + (BigInt(r[1] ?? "0x0") << 128n);
}

async function main() {
  const txHash = process.argv.slice(2).find((a) => a.startsWith("0x"));

  for (const url of RPCS) {
    const provider = new RpcProvider({ nodeUrl: url });
    console.log(`== ${url.replace(/^https:\/\//, "")}`);
    try {
      console.log(`   block            ${await provider.getBlockNumber()}`);

      if (txHash) {
        try {
          const receipt = (await provider.getTransactionReceipt(txHash)) as unknown as {
            execution_status?: string;
            finality_status?: string;
            block_number?: number;
            actual_fee?: { amount?: string; unit?: string };
          };
          console.log(
            `   receipt          ${receipt.execution_status} ${receipt.finality_status} block ${receipt.block_number}`,
          );
          if (receipt.actual_fee?.amount) {
            console.log(
              `   fee paid         ${fmt(BigInt(receipt.actual_fee.amount))} ${receipt.actual_fee.unit ?? ""}`,
            );
          }
        } catch {
          console.log(`   receipt          not found for ${txHash}`);
        }
      }

      console.log(`   source ETH       ${fmt(await balanceOf(provider, ETH, SOURCE))}`);
      console.log(`   source STRK      ${fmt(await balanceOf(provider, STRK, SOURCE))}`);
      console.log(`   destination ETH  ${fmt(await balanceOf(provider, ETH, DESTINATION))}`);
    } catch (e) {
      console.log(`   unreachable: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  if (!txHash) {
    console.log("\nNo transaction hash given, so balances only.");
    console.log("Pass one to check its receipt: npm run recovery:verify -- 0x…");
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
