/**
 * Differential test: our registration construction against the upstream SDK.
 *
 *   PRIVACY_SDK_SRC=/path/to/starknet-privacy/sdk npx tsx scripts/differential-register.ts
 *
 * Nothing is broadcast, nothing is proved, no network is required beyond one
 * read of the pool ABI, and no key from `.env.local` is touched: the test signs
 * with a fixed throwaway key so both sides are deterministic and comparable.
 *
 * Why this exists: the official SDK is not installable from npm (404) or GitHub
 * Packages (401), so `scripts/lib/register-invocation.ts` reproduces its
 * construction by hand. That is exactly the kind of code that fails quietly and
 * expensively. This runs both implementations on identical inputs and compares
 * every field of the resulting proof invocation.
 *
 * Get the upstream source with:
 *
 *   git clone --depth 1 --branch PRIVACY-0.14.3-RC.2 \
 *     https://github.com/starkware-libs/starknet-privacy.git
 *   cd starknet-privacy/sdk && npm ci --ignore-scripts
 *
 * Its dependencies are all public; no registry credentials are needed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { CairoCustomEnum, RpcProvider, Signer, constants } from "starknet";
import { NETWORKS } from "../src/utils/networks";
import {
  buildProofInvocation,
  getDefaultProofDetails,
  serializeClientActions,
} from "./lib/register-invocation";

/**
 * The upstream checkout to test against. A path argument wins over the
 * environment variable, so a second tag can be checked without re-exporting.
 *
 *   npx tsx scripts/differential-register.ts /path/to/starknet-privacy/sdk
 *
 * `EXPECTED_SDK_TAG` optionally pins which revision this run is allowed to
 * accept. A differential pass against RC.2 says nothing about RC.5, so when the
 * team names a different tag, check out that tag and set this.
 */
const SDK = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env.PRIVACY_SDK_SRC;
const EXPECTED_TAG = process.env.EXPECTED_SDK_TAG;
const NET = NETWORKS.mainnet;

/** Identify the checkout, so the result is attributable to a revision. */
function describeCheckout(sdkDir: string): { version: string; commit: string; tag: string } {
  let version = "unknown";
  try {
    version = JSON.parse(readFileSync(`${sdkDir}/package.json`, "utf8")).version ?? "unknown";
  } catch {
    /* reported as unknown */
  }
  const git = (args: string[], cwd: string) => {
    try {
      return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };

  // A shallow or partial checkout can leave git unable to open the repo even
  // though .git is there. The commit is still readable straight out of HEAD,
  // and reporting it beats printing "unknown" next to a PASS.
  const parent = dirname(sdkDir);
  let commit = git(["rev-parse", "HEAD"], sdkDir) || git(["rev-parse", "HEAD"], parent);
  if (!commit) {
    for (const dir of [sdkDir, parent]) {
      try {
        const head = readFileSync(`${dir}/.git/HEAD`, "utf8").trim();
        if (/^[0-9a-f]{40}$/.test(head)) {
          commit = head;
          break;
        }
      } catch {
        /* try the next candidate */
      }
    }
  }
  const tag =
    git(["describe", "--tags", "--always"], sdkDir) ||
    git(["describe", "--tags", "--always"], parent) ||
    (commit ? commit.slice(0, 7) : "");

  return {
    version,
    commit: commit || "unreadable",
    tag: tag || `v${version}`,
  };
}

// Fixed, disposable, and never funded. Determinism matters more than secrecy
// here, and a throwaway keeps a real key out of a comparison harness.
const TEST_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
const TEST_ADDRESS = "0x47366fff6d7da5f313cf6a379f460c8544db248231a532e533afd588d801aca";
const TEST_VIEWING_KEY = 0x0a11ce5eece0123456789abcdefn;
const TEST_RANDOM = 0x5eed5eed5eedn;

const J = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}` : x));

function compare(label: string, ours: unknown, theirs: unknown): boolean {
  const a = J(ours);
  const b = J(theirs);
  const same = a === b;
  console.log(`  ${same ? "same " : "DIFF "} ${label}`);
  if (!same) {
    console.log(`        ours   ${a.slice(0, 220)}`);
    console.log(`        theirs ${b.slice(0, 220)}`);
  }
  return same;
}

async function main() {
  if (!SDK || !existsSync(SDK)) {
    console.error(
      "PRIVACY_SDK_SRC is not set, or does not exist.\n" +
        "Point it at the `sdk` directory of a checkout of starknet-privacy at the\n" +
        "compatible tag. See the header of this file for the two commands.",
    );
    process.exit(1);
  }

  const url = (p: string) => pathToFileURL(`${SDK}/src/internal/${p}`).href;
  const upstreamFactory = await import(url("proof-invocation-factory.js"));
  const upstreamSerial = await import(url("serialization.js"));

  const provider = new RpcProvider({ nodeUrl: NET.rpc });
  const cls = (await provider.getClassAt(NET.pool)) as unknown as { abi: unknown };
  const abi = typeof cls.abi === "string" ? JSON.parse(cls.abi) : cls.abi;

  // Identical inputs for both sides.
  const action = { type: "SetViewingKey" as const, input: { random: TEST_RANDOM } };
  const cairoActions = upstreamSerial.serializeClientActions([action]) as CairoCustomEnum[];
  const ourCairoActions = serializeClientActions([action]);

  const signer = new Signer(TEST_KEY);
  const ourDetails = getDefaultProofDetails(NET.chainId);
  const theirDetails = upstreamFactory.getDefaultProofDetails(
    NET.chainId as constants.StarknetChainId,
  );

  const checkout = describeCheckout(SDK);
  console.log(`upstream      ${SDK}`);
  console.log(`sdk version   ${checkout.version}`);
  console.log(`sdk commit    ${checkout.commit}`);
  console.log(`sdk tag       ${checkout.tag}`);
  console.log(`pool          ${NET.pool}`);
  console.log(`pool class    ${await provider.getClassHashAt(NET.pool)}`);
  console.log(`account       ${TEST_ADDRESS}`);
  console.log(`signer        fixed throwaway, not from .env.local`);

  // A pass against one revision says nothing about another, so a run may be
  // pinned to the revision the team actually named.
  if (
    EXPECTED_TAG &&
    !checkout.tag.includes(EXPECTED_TAG) &&
    !checkout.version.includes(EXPECTED_TAG)
  ) {
    console.error(
      `\nREFUSED: EXPECTED_SDK_TAG is ${EXPECTED_TAG}, but this checkout reports ` +
        `${checkout.tag} / ${checkout.version}.`,
    );
    process.exit(1);
  }
  console.log("");

  let allSame = true;

  // Compare the action serialization itself, not just what follows it. Every
  // action type is checked, because the variant-index bug this guards against
  // is invisible for SetViewingKey and fatal for the rest.
  console.log("client action serialization");
  for (const type of [
    "SetViewingKey",
    "OpenChannel",
    "Deposit",
    "UseNote",
    "Withdraw",
    "InvokeExternal",
  ] as const) {
    const a = { type, input: { random: TEST_RANDOM } };
    allSame =
      compare(
        type,
        serializeClientActions([a as never]),
        upstreamSerial.serializeClientActions([a]),
      ) && allSame;
  }
  allSame = compare("used for this run", ourCairoActions, cairoActions) && allSame;

  console.log("\ndefault proof details");
  allSame = compare("resourceBounds", ourDetails.resourceBounds, theirDetails.resourceBounds) && allSame;
  allSame = compare("nonce", ourDetails.nonce, theirDetails.nonce) && allSame;
  allSame = compare("tip", ourDetails.tip, theirDetails.tip) && allSame;
  allSame = compare("skipValidate", ourDetails.skipValidate, theirDetails.skipValidate) && allSame;
  allSame =
    compare("nonceDataAvailabilityMode", ourDetails.nonceDataAvailabilityMode, theirDetails.nonceDataAvailabilityMode) &&
    allSame;
  allSame = compare("version", ourDetails.version, theirDetails.version) && allSame;

  const ours = await buildProofInvocation({
    abi,
    poolAddress: NET.pool,
    userAddress: TEST_ADDRESS,
    viewingKey: TEST_VIEWING_KEY,
    cairoActions,
    signer,
    details: ourDetails,
  });

  const theirs = await new upstreamFactory.ProofInvocationFactory().create(
    { address: TEST_ADDRESS, signer, viewingKey: TEST_VIEWING_KEY },
    NET.pool,
    [action],
    theirDetails,
  );

  console.log("\nproof invocation");
  for (const field of [
    "type",
    "sender_address",
    "calldata",
    "signature",
    "nonce",
    "resource_bounds",
    "tip",
    "paymaster_data",
    "account_deployment_data",
    "nonce_data_availability_mode",
    "fee_data_availability_mode",
    "version",
  ] as const) {
    allSame =
      compare(field, (ours.invocation as unknown as Record<string, unknown>)[field], (theirs as Record<string, unknown>)[field]) &&
      allSame;
  }

  console.log(
    allSame
      ? `\nVERDICT: identical. Our construction matches upstream ${checkout.tag} on every field.`
      : "\nVERDICT: DIVERGENT. Do not broadcast. Every difference above must be explained.",
  );
  if (!allSame) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`\nFAILED: ${e?.message ?? e}`);
  process.exit(1);
});
