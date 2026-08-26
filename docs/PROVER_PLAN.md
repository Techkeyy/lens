# Proving plan

Written at specification level. Nothing here has been provisioned, rented or
started, and no paid resource exists.

Status as of 2026-08-25.

---

# The decision

A third-party hosted prover is acceptable on **Sepolia only**, with a disposable
test actor. On **mainnet** the prover must be operated by Lens.

The reason is in [MAINNET_EVIDENCE.md](./MAINNET_EVIDENCE.md#user_private_key-is-the-viewing-key-and-it-goes-to-the-prover):
the proved transaction's calldata is `(user_addr, user_private_key,
client_actions)`, and `user_private_key` is the viewing key. Whoever runs the
prover sees it. The SDK's OHTTP transport hides who is asking, not what is sent.

For a project whose whole claim is that the viewing key is never handed over,
that is not a detail to accept quietly on mainnet.

---

# Sepolia: hosted, and firewalled from production

When the sprint team supplies a Sepolia proving URL, the rehearsal runs with a
**disposable Sepolia actor and nothing else**.

Hard rules, to be enforced in code before the first call:

| Never used with a hosted prover | Why |
| --- | --- |
| `MAINNET_PRIVATE_KEY` | it controls the mainnet deployer |
| The production Lens mainnet viewing key | the prover would learn it permanently |
| Any real disclosure or channel key | they are bearer credentials |

The Sepolia prover operator should be assumed to see the **test** viewing key.
That is acceptable because the test actor holds testnet funds and is thrown away
afterwards. It is integration testing, not the production architecture, and no
claim about mainnet privacy may be based on it.

---

# Mainnet compatibility: SOLVED, and the pool class was a red herring

`SAFE_TO_SELF_HOST_MAINNET` was NO because the live pool class did not match
the published matrix row. That reasoning was aimed at the wrong artefact.

**The pool does not verify the proof.** `validate_proof` destructures
`ProofFacts` and discards `virtual_program_hash` and
`starknet_os_config_hash`, asserting only `program_variant`,
`starknet_os_output_version`, block freshness, and that the message hash binds
the actions. The real verifier is the **sequencer**, which populates
`tx_info.proof_facts` only for proofs it has accepted. So the question was never
"which pool class is deployed", it was "which proof program does the sequencer
accept".

That is readable from chain, and it is unambiguous.

## Reading the answer off mainnet

`proof_facts` is not serialized by `starknet_getTransactionByHash` on any RPC
tested, which is why this took a detour. The **feeder gateway** does return it:

```
https://feeder.alpha-mainnet.starknet.io/feeder_gateway/get_transaction?transactionHash=0x…
```

Decoded from a real first shield, `0x4f5c1296…`:

| Field | Value |
| --- | --- |
| `proof_version` | `0x50524f4f4631` = `"PROOF1"` |
| `program_variant` | `0x5649525455414c5f534e4f53` = `"VIRTUAL_SNOS"` |
| **`virtual_program_hash`** | **`0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1`** |
| `starknet_os_output_version` | `0x5649525455414c5f534e4f5330` = `"VIRTUAL_SNOS0"` |
| `base_block_number` | 13,853,698 |

Sampled across **14 recent successful pool transactions**, spanning blocks up to
13,883,135: **14 of 14 carry the identical `virtual_program_hash`.** There is one
accepted program, not a range.

## Mapping that program to an image

| Evidence | Value |
| --- | --- |
| Live mainnet pool transactions, 14/14 | `virtual_program_hash` `0x53f6c9fc…96daa1` |
| `starknet-innovation/snip-36-prover-backend`, `.github/workflows/daily-health.yml` | `EXPECTED_VIRTUAL_OS_PROGRAM_HASH: '0x53f6c9fc…96daa1'`, asserted in CI and built from `SEQUENCER_TAG: e6b6fd2e9932909107833579e5b6efd6c75fa0af` |
| `transaction-prover:PRIVACY-0.14.3-RC.2`, OCI config label | `org.opencontainers.image.revision` = `e6b6fd2e9932909107833579e5b6efd6c75fa0af` |
| `starkware-libs/sequencer` commit `e6b6fd2e` | 2026-07-01, "starknet_transaction_prover: default blocking-check to fail-closed" |

Three independent sources converge on one sequencer commit, and the published
`PRIVACY-0.14.3-RC.2` image is built from exactly it.

**Confidence: EXACT.** The published matrix row was right; only the reason for
trusting it was wrong. Newer is not better here: `APOLLO-0.14.3-RC.16` was built
2026-08-24 from revision `7dcab710…`, a different commit, and mainnet is still
accepting the `e6b6fd2e` program.

| Artefact | Value |
| --- | --- |
| Image | `ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2` |
| amd64 digest | `sha256:a62e7764e034ea25d84d4a235f1f683f7c5f03f88f6646a744599171bf5ca58c` |
| Source commit | `e6b6fd2e9932909107833579e5b6efd6c75fa0af` |
| SDK revision | `PRIVACY-0.14.3-RC.2`, differential PASS |
| Registry auth | none |

**SAFE_TO_SELF_HOST_MAINNET = YES**, on evidence, subject to the runtime check
below.

## The check that runs before any fee is paid

Programs can be rotated, and `APOLLO-0.14.3-RC.16` shows the lineage is moving.
So the mapping is not trusted as a static fact. `scripts/lib/live-program-hash.ts`
re-reads the accepted program from recent pool transactions, and
`register-lens.ts` refuses in two places:

1. **Before proving**, if the live program hash no longer matches the expected
   one, or if sampled transactions disagree, which would mean a rotation is in
   progress.
2. **After proving and before submitting**, if the prover's own
   `proof_facts[2]` is not the accepted program. An incompatible image is
   detected at zero cost, because a proof is free and only `apply_actions`
   costs money.

That converts the compatibility question from a judgement into a gate.

## The pool class, chased down separately

The class mismatch does not block anything, because the pool is not the
verifier. It is still worth resolving, because every conclusion in these
documents about screening, `validate_proof` ordering and entry points was read
from `privacy.cairo` at RC.2. If the deployed class is not a published revision,
that source is not authoritative for the deployed behaviour.

So the class hashes were reproduced from source rather than guessed at.

**Method, validated before use.** scarb `2.17.0` is pinned by the repository's
own `.tool-versions`, and the workspace sets `[profile.release.cairo]
inlining-strategy = 250`, which changes the class hash. Building `PRIVACY-0.14.3-RC.0`
with scarb 2.17.0 on the **release** profile reproduces the published class
hash exactly:

```
built    0x52107fadffab71bdcbb6b2ccb68ba3e1b5558d94036538053e159d3076ad633
matrix   0x52107fadffab71bdcbb6b2ccb68ba3e1b5558d94036538053e159d3076ad633
```

A `dev`-profile build gives `0x215be199…`, which is neither, and is the trap
worth recording: a profile mismatch produces a plausible-looking wrong answer.

With the method proven, the same build is run across the 0.14.3 tags to find
which, if any, produces the deployed `0x67dddd89…b554d`. Results are recorded in
[MAINNET_EVIDENCE.md](./MAINNET_EVIDENCE.md).

# Deployment specification

Everything below is read from the prover crate's own README and the monorepo
compatibility matrix. A ready-to-run compose file is at
[deploy/prover/docker-compose.yml](../deploy/prover/docker-compose.yml), pinned
by digest rather than tag, bound to localhost, and reached over an SSH tunnel
because the prover receives the viewing key.

**Nothing has been started, rented or paid for.**

| Item | Value |
| --- | --- |
| Image | `transaction-prover@sha256:a62e7764e034ea25d84d4a235f1f683f7c5f03f88f6646a744599171bf5ca58c` (`PRIVACY-0.14.3-RC.2`) |
| Registry auth | none, the ghcr manifest answers anonymously |
| Architecture | `linux/amd64` only, no arm64 manifest published |
| Recommended machine | `c4d-highcpu-48`: 48 vCPU, 96 GB RAM |
| Minimum | not published. The README gives a recommendation, not a floor |
| Disk | not published. No chain data is stored; the container is stateless and pulls state over RPC |
| `RPC_URL` | **required**, a Starknet node speaking JSON-RPC **v0.10** |
| Pathfinder | **not strictly required.** The matrix pins `eqlabs/pathfinder:v0.22.7` with `PATHFINDER_STORAGE_STATE_TRIES=10000`, but the prover's only node interface is `RPC_URL`. Cartridge and Lava both answer `starknet_specVersion` with `0.10.2` on mainnet |
| `CHAIN_ID` | `SN_MAIN` (default) |
| Port | `PROVER_PORT`, default `3000` |
| Bind | `PROVER_IP`, default `0.0.0.0`; use `127.0.0.1` behind a proxy |
| Health endpoint | JSON-RPC `starknet_specVersion` on `/`, expect `0.10.0` |
| Concurrency | `MAX_CONCURRENT_REQUESTS` default `2`; over capacity returns `-32005` |
| TLS | `TLS_CERT_FILE` + `TLS_KEY_FILE`, both or neither |
| CORS | off by default; `CORS_ALLOW_ORIGIN` if a browser calls it directly |
| Accepts | Invoke V3 only, finalized blocks only, one transaction per request |
| Fee fields | every `max_price_per_unit` and `tip` must be zero, or `SKIP_FEE_FIELD_VALIDATION=true` |
| Proof interceptor | **not needed.** It screens `Deposit` actions only, and Lens's single proving need is registration |
| OHTTP | **optional.** It hides the client IP from the prover. Pointless when Lens runs the prover itself, and it does not conceal the viewing key in either case |
| Proving latency | not published. The SDK's default request timeout is 30 s and its comment says "proofs typically take a few seconds", which is the only figure available |

## What this machine can do

| | Required | Available here |
| --- | --- | --- |
| vCPU | 48 recommended | 4 |
| RAM | 96 GB | 15.9 GB |
| Docker | yes | 29.7.2, installed |
| Architecture | amd64 | amd64 |

Twelve times short on CPU and six times short on memory. No configuration flag
closes that, so local proving is not a tuning exercise.

## Cost

StarkWare publish no figure, so this comes from current provider pricing for the
exact machine type they recommend.

`c4d-highcpu-48` (48 vCPU, 90 GB) on-demand, read 2026-08-26:

| Region | USD / hour |
| --- | --- |
| us-central1, us-east1, us-east4, us-east5, us-west1 | **1.9076** |
| europe-west4 | 2.0029 |
| europe-west2 (London) | 2.1746 |
| asia-northeast1 (Tokyo) | 2.4497 |

The workload is **one proof**. The container is stateless, pulls state over RPC,
and holds the machine only while it runs. Allowing a generous hour for boot,
image pull, the proof and teardown, the realistic cost is **about two dollars**,
and two hours would still be about four.

That is worth stating plainly because this has been discussed as though it were
a serious infrastructure commitment. It is not. The constraint was never the
money, it was not knowing which image to run, and that is now settled.

Cheaper options exist (spot instances, or a fixed-price host such as Hetzner's
48-vCPU tier) but none of them is worth the added uncertainty for a two-dollar,
one-shot job on a deadline.

**Infrastructure started: none. Nothing rented, nothing paid.**

---

# Getting the SDK

`@starkware-libs/starknet-privacy-sdk` is **not installable** from the obvious
places: npmjs returns 404, and GitHub Packages returns 401 even with a token.
Three routes were considered, in the order the director set.

**A. Official package access.** Blocked, and **no longer needed**. It is off the
blocker list.

**B. Build from the official tag. This works, and is the route taken.**

```bash
git clone --depth 1 --branch PRIVACY-0.14.3-RC.2 https://github.com/starkware-libs/starknet-privacy.git
cd starknet-privacy/sdk && npm ci --ignore-scripts
```

Verified: a sparse checkout of `sdk/` at that tag resolves to commit
`9bfeb8dd35565a2915a0617dff3f649bd5bb891a`, 54 TypeScript source files, and
`npm ci` installs 312 packages with **no registry credentials**. Every
dependency is public: `@starknet-io/types-js`, `ohttp-ts`, `starknet`,
`starknet-devnet`, `zod`.

Nothing from that checkout is vendored into this repository. It is used as a
reference implementation to test against, which is route B rather than route C.

**C. Vendoring.** Not needed, and not done.

## The differential test

`scripts/lib/register-invocation.ts` mirrors upstream's
`ProofInvocationFactory`. `scripts/differential-register.ts` runs both on
identical inputs and compares every field:

```bash
PRIVACY_SDK_SRC=/path/to/starknet-privacy/sdk npx tsx scripts/differential-register.ts
```

It found four real differences, and each would have cost a mainnet fee:

| # | Hand-written version | Upstream |
| --- | --- | --- |
| 1 | fetched the pool's live nonce | hardcoded `0n`, "no chain fetch" |
| 2 | `l1_gas` / `l1_data_gas` `max_amount: 0n` | `max_amount: 1n`; only the *prices* are zero |
| 3 | hand-computed the transaction hash | `signer.signTransaction` with `walletAddress` set to the pool |
| 4 | `sender_address` left zero-padded | normalized through BigInt, so `0x0403…` becomes `0x403…` |

A fifth was found by inspection rather than by the harness: upstream builds the
action enum with **all nine variant keys present** and only the active one
defined. Building it with a single key lets starknet.js infer the variant index
from the object's own keys instead of the Cairo variant order. That is correct
by accident for `SetViewingKey`, which is index 0, and wrong for every other
action. The test now compares six action types, not just the one being used.

Current result: **identical on all 25 compared fields**, against sdk commit
`9bfeb8dd35565a2915a0617dff3f649bd5bb891a`, version `0.14.3-rc.2`, with the live
pool class `0x67dddd89…` recorded alongside. `register-lens.ts` was then rewired
onto the tested module, so the code that would broadcast is the code that was
verified.

**A pass against one revision says nothing about another.** If the team names a
tag other than RC.2, check that tag out and re-run, pinning it so a stale
checkout cannot quietly satisfy the gate:

```bash
EXPECTED_SDK_TAG=<their-tag> npx tsx scripts/differential-register.ts /path/to/sdk
```

The harness prints the checkout's version, commit and tag, and refuses when the
pin does not match.

This does **not** clear the script for mainnet. Two of the three gate conditions
are still open: the compatible prover revision and its request schema. A
mainnet `--send` refuses unless `LENS_REGISTER_APPROVED=1` is set explicitly.

---

# Wording that a Lens-operated prover would falsify

Recorded now so it cannot be forgotten, and deliberately **not** yet changed.
Nothing in this list is false today, because Lens does not currently talk to a
prover at all. Each becomes false only if and when registration is added through
a remote prover.

| Location | Current wording | Why it breaks |
| --- | --- | --- |
| [docs/PRODUCT.md](./PRODUCT.md) data table | Viewing key: "never stored, never asked for, never sent" | "never sent" stops being true at registration |
| [THREAT_MODEL.md](../THREAT_MODEL.md), "Our server seeing anything" | "There is no server in the path" | there would be one, for registration |
| [src/core/session.ts](../src/core/session.ts) `Session` doc comment | "never written anywhere: no localStorage, no cookie, no server" | still never *written*, but it would be *sent* |

The accurate replacement is narrower and still strong:

> Your master viewing key is never shared with the verifier, and never with a
> third-party proving service. Proving runs on infrastructure Lens operates.

Three claims audited and found **still true** even with a remote prover, so they
should not be weakened:

- [src/core/transport.ts](../src/core/transport.ts) and the README's sharing
  diagram: the disclosure fragment still never leaves the browser. Proving has
  nothing to do with the disclosure path.
- The README's "reads the payments locally": reads still go browser-to-RPC.
- The holder page's "never asks for your viewing key": Lens derives it from a
  signature and still never asks.

---

# Budget for the four planned pool operations

`collect_fee()` runs unconditionally inside `apply_actions`, so **every** pool
operation costs `get_fee_amount()`, live value **6 STRK**. It is a
`transferFrom`, so the submitting account must first approve the pool, which is
an ordinary ERC-20 call and not a pool operation.

Gas is an estimate, and labelled as one. The basis is the registry deploy invoke
measured at 0.037 STRK; an `apply_actions` call carries more calldata, so 0.5
STRK per operation is used as a deliberately generous upper bound.

| Operation | Actor | Pool fee | Gas (est.) | Value moved |
| --- | --- | --- | --- | --- |
| Lens registration | Lens | 6 | ≤0.5 | none |
| Ready screened deposit | Ready | 6 | ≤0.5 | the deposit amount |
| Private transfer A to Lens | Ready | 6 | ≤0.5 | inside the pool |
| Private transfer B to Lens | Ready | 6 | ≤0.5 | inside the pool |
| Lens authorize | Lens | none | ≤0.1 | none |
| Lens revoke | Lens | none | ≤0.1 | none |

| Actor | Holds | Committed | Left |
| --- | --- | --- | --- |
| Lens `0x4736...1aca` | 17.85 | ≈6.7 | ≈11.1 |
| Ready `0x04c7...99c8` | 24.94 | ≈19.5 + deposit | ≈5.4 minus the deposit |

**Additional external funding required: none.** The two accounts hold 42.79 STRK
between them against roughly 26 STRK of fees and gas.

The distribution is the tight part, not the total. Ready carries three of the
four pool operations, so it must cover 18 STRK of fees on a 24.94 STRK balance,
leaving about 5.4 STRK for the deposit. A deposit of **3 STRK, sent onward as
two transfers of 1 STRK**, fits with roughly 2.4 STRK of headroom and keeps the
demo readable.

If more headroom is wanted, it should come from moving about 5 STRK from Lens to
Ready rather than from a top-up. Lens has the spare and the total is sufficient.
Moving it is a transfer, which this agent does not execute.

Neither account holds USDC, so the demo is STRK-denominated.
