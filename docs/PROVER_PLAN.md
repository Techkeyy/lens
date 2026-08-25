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

# Mainnet: SAFE_TO_SELF_HOST_MAINNET = NO

Not because self-hosting is wrong, but because the version is unknown.

| | Class hash |
| --- | --- |
| Live mainnet pool `0x0403...812a` | `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` |
| Published matrix (`PRIVACY-0.14.3-RC.0`) | `0x52107fadffab71bdcbb6b2ccb68ba3e1b5558d94036538053e159d3076ad633` |

The matrix row exists to be used whole, and the pool on mainnet is not the pool
in that row. Standing up `RC.2` because it is the last published row would be
guessing with real money.

**Blocking question for the sprint team:** which `transaction-prover` image and
SDK revision are compatible with the pool class actually deployed at
`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`? Already
asked; awaiting the answer.

---

# Deployment specification, for when the tag is confirmed

Everything below is read from the prover crate's own README and the monorepo
compatibility matrix. The image tag is deliberately left as a placeholder.

| Item | Value |
| --- | --- |
| Image | `ghcr.io/starkware-libs/starknet-privacy/transaction-prover:<CONFIRMED_TAG>` |
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

Not stated in any StarkWare document, and this repository has no cloud pricing
tool to query, so **no cost figure is asserted here**. What can be said without
inventing numbers: the workload is one proof, the container is stateless, and it
needs the machine only for the minutes it runs. That shape suits an
on-demand instance destroyed immediately afterwards rather than anything
standing. The exact rate should be read off the provider's own pricing page at
the time, by a person, before anything is created.

**Infrastructure started: none.**

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
