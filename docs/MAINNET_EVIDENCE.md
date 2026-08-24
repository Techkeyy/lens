# Mainnet evidence

An engineering ledger. Every hash here was confirmed on chain. Nothing is
predicted, planned or padded, and anything not yet done says so.

Two categories are kept apart on purpose, because they prove different things
and only the first satisfies the sprint's live-pool requirement.

Status as of 2026-08-25.

---

# STRK20 LIVE-POOL TRANSACTIONS

**None.** No transaction has been made against the STRK20 privacy pool on
mainnet or on Sepolia.

This is blocked by a dependency outside the repository. See
[The proving blocker](#the-proving-blocker) below for the evidence trail.

Required by the sprint: three mainnet transactions run against the live pool.
Current count: **0 of 3**.

---

# LENS REGISTRY

**Not deployed on mainnet.**

| Item | Value |
| --- | --- |
| Class hash | `0x767bfcbdf3fcebc0836cd1d050aa4daed9ec1d10e152f59df222e708ea2e616` (built, declared on Sepolia only) |
| Mainnet registry | none |
| Mainnet declare | none |
| Mainnet deploy | none |
| Mainnet authorization | none |
| Mainnet revocation | none |
| Deployer | `0x47366fff6d7da5f313cf6a379f460c8544db248231a532e533afd588d801aca` |
| Deployer STRK | 0.0000 |
| Deployer ETH | 0.001027 |

Blocked by fee-token mismatch, not by an empty account. See
[Funding reconciliation](#funding-reconciliation). The deployment path is written, rehearsed end to end
on Sepolia, and captures its own deployment block for the event-scan floor. See
[docs/DEV_EVIDENCE.md](./DEV_EVIDENCE.md) for the Sepolia rehearsal, which is
development evidence and is deliberately not listed here.

---

# REAL DISCLOSURE

**None on mainnet.**

A disclosure requires a relationship to disclose, and no relationship can exist
until the proving blocker is resolved. Every other part of the path is built and
tested: `createDisclosure`, the V2 snapshot commitment, the consent preview, the
walletless proof page, and the registry lifecycle.

---

# Funding reconciliation

The account **was** funded, with **ETH rather than STRK**.

Verified at mainnet block ~13,812,010 by direct `balanceOf` on three
independent RPCs (Cartridge, Lava, Alchemy), all agreeing:

| Token | Balance |
| --- | --- |
| STRK | 0.000000 |
| ETH | 0.001027 |

The account is still undeployed (`Contract not found`), which is expected for a
counterfactual address that has never sent a transaction.

**Why ETH cannot be used directly.** starknet.js builds V3 transactions only
(`transactionVersion: ETransactionVersion.V3`), and V3 resource bounds are
denominated in FRI, which is STRK. There is no ETH fee path.

**Why a paymaster does not fully solve it.** The AVNU paymaster built into
starknet.js (`https://starknet.paymaster.avnu.fi`) answers without an API key
and does accept ETH as a gas token, confirmed against its live
`paymaster_getSupportedTokens`. But its transaction union is
`Deploy | Invoke | DeployAndInvoke`: **a paymaster cannot carry a DECLARE**, and
declaring the registry class is exactly what the deployment needs. So the
paymaster could deploy the account and run `authorize` and `revoke`, and cannot
publish the contract class.

**What would resolve it**, cheapest first:

1. Send roughly **50 STRK** (about a dollar) to the deployer. One step.
2. Swap the existing ETH to STRK. Enough value is present, but executing a swap
   is a financial trade and is not something this agent performs; a human can do
   it in a wallet in under a minute.

# The proving blocker

The single dependency standing between this repository and every item above.

## What is needed

A STRK20 proving service endpoint. Every write to the pool, including the
registration that would make an account readable by Lens, goes through
`.execute({ provingBlockId })`, which requires a configured proving provider.

## Where it was looked for

| Source | Result |
| --- | --- |
| `@starkware-libs/starknet-privacy` monorepo, `demo/.env.mainnet.example` | `VITE_PROVING_SERVICE_URL=TODO_MAINNET_PROVER_URL` |
| Same repo, `sdk/README.md` | Takes `provingProvider` as a parameter, publishes no endpoint |
| `strk20-by-example.org/sdk/proving-config` | `process.env.PROVING_SERVICE_URL!`, no value published |
| `starkware-libs/privacy-bridge`, StarkWare's own shipping product | `VITE_PROVER_URL_${N}` from env, test placeholder `https://prover.example.com` |
| `@avnu/avnu-sdk` 4.2.0 | Ships no prover. `createStrk20WalletProver` delegates to the wallet |
| Repository's own `strk20-privacy-integration` skill | Names hosted and self-hosted as the two options, publishes no endpoint |

No official source available locally publishes a proving endpoint for either
network. It appears to be provisioned per team, or shared in the sprint's
support channel.

## Why the wallet route does not substitute

The Wallet API route can create genuine mainnet pool activity, because Ready
performs the proving. The AVNU SDK states the mechanism plainly:

> The wallet keeps the keys and notes and generates the proof

That is exactly why it does not help Lens. A relationship created through a
wallet belongs to **that wallet's viewing key**. Lens derives its own viewing
key from a signature, so it cannot read notes registered under a different key,
and the Wallet API exposes no method to obtain one. The STRK20 docs are explicit
that a dapp must never receive a user's viewing key.

So the two routes fail for opposite reasons:

- **Wallet route:** can transact, cannot be read by Lens.
- **SDK route:** can be read by Lens, cannot transact without a prover.

## Screening is a second, separate blocker for deposits

Read from the live mainnet pool during this phase:

| Call | Value |
| --- | --- |
| `get_version` | `2.0` |
| `get_screener_public_key` | set, non-zero (`0x501cc452…`) |
| `get_fee_amount` | `6.0 STRK` per pool operation |

`apply_actions` takes a `ScreeningAttestation`, and the docs are explicit that
screening applies on every route: *"a self-hosted prover meets the same
deposit-screening requirement as hosted services."* The attestation is signed by
the screener whose public key is set above, which no builder can produce.

So a self-hosted prover does **not** unblock this project. Without a screened
deposit there is nothing in the pool to transfer, and the deposit is the step
that needs the attestation. The hosted service is required for screening, not
merely for convenience.

Also worth recording for budgeting: at 6 STRK per pool operation, three
live-pool transactions cost **18 STRK in pool fees alone**, before gas.

## The indexer is not a blocker

Removed from this list after checking. The SDK ships
`ContractDiscoveryProvider`, which reads the pool directly over RPC with no
hosted indexer, and the factory documents `new ContractDiscoveryProvider(pool)`.

Lens does not need it either way: `read.ts` and `channels.ts` already walk the
pool over plain RPC, which is the same approach. No indexer dependency exists or
is planned.

## What would unblock it

Any one of:

1. A proving service URL for mainnet, **plus** a way to obtain a screening
   attestation for the first deposit. Both come from the hosted service today.
2. A Wallet API method letting a dapp use the wallet as a proving backend for an
   SDK-built transaction, which does not exist.

Self-hosting is **rejected**, not deferred. The prover crate is open source at
`starkware-libs/sequencer/crates/starknet_transaction_prover`, but running it
does not produce a screening attestation, and the deposit cannot be accepted
without one. Standing up prover infrastructure would leave the project exactly
as blocked as it is now, at considerable cost.

Exact question for the sprint channel:

> I am building for the STRK20 Private Sprint and need to create genuine
> mainnet private-transfer activity using the Privacy SDK with my own
> `viewingKeyProvider`. I can use `ContractDiscoveryProvider` directly against
> the pool, so discovery is not a blocker. Two questions. What is the currently
> supported hosted proving-service URL and configuration for the mainnet pool?
> And since `get_screener_public_key` is set on the mainnet pool and
> `apply_actions` takes a `ScreeningAttestation`, how does a builder obtain a
> screening attestation for a deposit? If self-hosted provers are allowed, which
> prover version matches pool version 2.0, and does self-hosting still require
> the hosted screening service?

---

# Ready to run the moment it unblocks

| Step | Command | State |
| --- | --- | --- |
| Verify a live relationship | `npx tsx scripts/verify-relationship.ts <holder> <counterparty> --mainnet` | written, exercised against live mainnet reads |
| Deploy the registry | `npx tsx scripts/deploy-registry.ts --mainnet --tight` | rehearsed on Sepolia, records its deployment block |
| Full disclosure lifecycle | `npx tsx scripts/e2e-sepolia.ts` | passing on Sepolia against the live contract |

`verify-relationship.ts` was run against mainnet during this phase. It reads the
real pool and reports correctly that neither demo address is registered, which is
the expected answer today.

---

# Demo actors

Both addresses are controlled demonstration accounts created for this project.
Neither holds or has held anything but the small amounts needed for testing, and
neither is a personal wallet.

| Role | Address | Network |
| --- | --- | --- |
| Lens deployer | `0x47366fff6d7da5f313cf6a379f460c8544db248231a532e533afd588d801aca` | mainnet, unfunded |
| Sepolia deployer | `0x56d8c42a83dc976ea0bf367639c0b5ce4f42ea262ae8d1a046f710e13659124` | sepolia, funded by faucet |

Secrets live only in `.env.local`, which is gitignored and confirmed ignored.
No key, signature or proof fragment appears in this document or any other.

---

# What `strk20.json` contains

Empty, deliberately. It carries mainnet submission evidence, and there is none
yet. It will be populated only with confirmed mainnet hashes, and never with
Sepolia hashes or placeholders.
