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
| Deployer balance | 0.0000 STRK |

Blocked by funding only. The deployment path is written, rehearsed end to end
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

## What would unblock it

Any one of:

1. A proving service URL for mainnet, and the matching indexer or discovery URL.
2. Confirmation that a self-hosted prover is expected, plus whatever
   configuration it needs. The crate is open source at
   `starkware-libs/sequencer/crates/starknet_transaction_prover`, and running it
   is an infrastructure commitment rather than a configuration change.
3. A Wallet API method that lets a dapp use the wallet as a proving backend for
   an SDK-built transaction, which does not exist today.

Exact question for the sprint channel:

> What proving service URL and indexer URL should a sprint team use for
> `ProvingServiceProofProvider` on mainnet and Sepolia? The demo `.env`
> examples list both as TODO, and the privacy-bridge repo reads them from env
> with no default.

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
