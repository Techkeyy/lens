/**
 * Fund the Sepolia deployer from the Starknet faucet's public agent API.
 *
 *   npx tsx scripts/faucet.ts             fund the address in .env.local
 *   npx tsx scripts/faucet.ts 0xabc…      fund a specific address
 *
 * No auth. Requests are gated by proof of work, quotas and cooldowns, so the
 * only work here is solving a hash puzzle locally and then waiting.
 *
 * The difficulty is in bits, not hex digits, so the check counts leading zero
 * bits rather than leading "0" characters. A difficulty of 21 is not five hex
 * zeros, and treating it as such either loops forever or accepts a bad nonce.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { CallData, ec, hash } from "starknet";

const BASE = "https://api.faucet.starknet.io";
const ENV_FILE = ".env.local";
const ACCOUNT_CLASS_HASH =
  "0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";

function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!existsSync(ENV_FILE)) return undefined;
  const line = readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

/** The counterfactual address for our key, so this works before deployment. */
function addressFromEnv(): string | undefined {
  const key = envValue("SEPOLIA_PRIVATE_KEY");
  if (!key) return undefined;
  const publicKey = ec.starkCurve.getStarkKey(key);
  return hash.calculateContractAddressFromHash(
    publicKey,
    ACCOUNT_CLASS_HASH,
    CallData.compile({ public_key: publicKey }),
    0,
  );
}

/** Leading zero bits of a digest, counted properly rather than by hex digit. */
export function leadingZeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function solve(prefix: string, difficulty: number, limit = 500_000_000): string {
  for (let nonce = 0; nonce < limit; nonce++) {
    const candidate = String(nonce);
    const digest = createHash("sha256").update(prefix + candidate).digest();
    if (leadingZeroBits(digest) >= difficulty) return candidate;
  }
  throw new Error(`no nonce found for difficulty ${difficulty} within ${limit} attempts`);
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return JSON.parse(text);
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return JSON.parse(text);
}

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

async function main() {
  const given = process.argv.find((a) => a.startsWith("0x")) ?? addressFromEnv();
  if (!given) {
    console.error("No address. Pass one, or run scripts/account.ts --new first.");
    process.exit(1);
  }
  // The faucet stores the address zero-padded to 32 bytes and embeds that form
  // in the proof-of-work input. Submitting the short form fails with
  // POW_CHALLENGE_INVALID even though the nonce is correct.
  const userAddress = "0x" + given.slice(2).padStart(64, "0");
  console.log(`address    ${userAddress}`);

  const challenge = await post("/api/public-agent/pow/challenge", { userAddress });
  const { challengeId, powInputPrefix, difficulty } = challenge.data;
  // Echo back exactly what the server says it hashed, rather than our own idea
  // of the address.
  const echoed: string = challenge.data.userAddress ?? userAddress;
  console.log(`challenge  ${challengeId}  difficulty ${difficulty} bits`);

  const started = Date.now();
  const nonce = solve(powInputPrefix, difficulty);
  console.log(`nonce      ${nonce}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);

  const request = await post("/api/public-agent/faucet/request", {
    userAddress: echoed,
    challengeId,
    nonce,
  });
  const { requestId } = request.data;
  let wait = request.data.pollAfterSeconds ?? 5;
  console.log(`request    ${requestId}`);

  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(wait);
    const status = await get(`/api/public-agent/faucet/status/${requestId}`);
    const { jobStatus, txHash, pollAfterSeconds } = status.data;
    console.log(`status     ${jobStatus}${txHash ? `  ${txHash}` : ""}`);
    if (jobStatus === "confirmed") {
      console.log(`\nfunded. Next: npx tsx scripts/account.ts --deploy`);
      return;
    }
    if (jobStatus === "failed") {
      console.error("\nfaucet job failed");
      process.exit(1);
    }
    wait = pollAfterSeconds ?? wait;
  }
  console.error("\ngave up waiting; check the request id later");
  process.exit(1);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
