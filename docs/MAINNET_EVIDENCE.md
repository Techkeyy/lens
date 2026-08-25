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
Current count: **0 of 3**. The Lens registry deployment is real mainnet
activity but is not pool activity, and is counted separately below.

---

# LENS REGISTRY

**Deployed on Starknet mainnet.**

| Item | Value |
| --- | --- |
| Contract | `0x7e14bc65e5f759da2a981843c485a948dc6e15548fe0ba51e3ca805ca75fb01` |
| Class hash | `0x767bfcbdf3fcebc0836cd1d050aa4daed9ec1d10e152f59df222e708ea2e616` |
| Declare | `0x6124e178200e715c9c0e6c2c6ed08bf1ea3a46a4b8b11b96e595abe0ff6f12d` (block 13,815,976, 4.0095 STRK) |
| Deploy | `0x4b41314ed39bc6d41b6791e4550c804e40da8e00b26c8cc8a36fa4b17e1d9d6` (block 13,815,987, 0.0370 STRK) |
| Deployment block | 13,815,987 |
| Mainnet authorization | none yet |
| Mainnet revocation | none yet |
| Deployer | `0x47366fff6d7da5f313cf6a379f460c8544db248231a532e533afd588d801aca` |
| Deployer STRK after | 17.8488 |

The class hash was recomputed from a fresh `scarb build` immediately before
declaring and is byte-identical to the class audited on Sepolia, so the two
networks run the same reviewed code.

Verified independently after deployment on three RPCs (Cartridge, Lava,
Alchemy), all three returning the same class hash at the address:

| Read | Result |
| --- | --- |
| `status(unknown commitment)` | `Unknown` |
| `is_authorized(unknown commitment)` | `false` |
| `get_authorization(unknown commitment)` | no record |
| `listHolderAuthorizations` from block 13,815,987 | 0 entries |

An unknown commitment reads as unauthorized rather than erroring, which is the
fail-closed behaviour the proof page depends on.

No authorization has been written on mainnet. Writing one would mean signing a
disclosure that describes no real payment, so the registry stays empty until a
genuine relationship exists.

The address and the deployment block are checked into
[src/utils/networks.ts](../src/utils/networks.ts). The block matters: without it
`listHolderAuthorizations` would scan mainnet from genesis.

---


# REAL DISCLOSURE

**None on mainnet.**

A disclosure requires a relationship to disclose, and no relationship can exist
until the proving blocker is resolved. Every other part of the path is built and
tested: `createDisclosure`, the V2 snapshot commitment, the consent preview, the
walletless proof page, and the registry lifecycle.

---

# Funding reconciliation, resolved

The account was originally funded with **ETH rather than STRK**. starknet.js
builds V3 transactions only, and V3 resource bounds are denominated in FRI,
which is STRK, so there is no ETH fee path and the balance was unusable.

A paymaster could not rescue it either: the AVNU paymaster's transaction union
is `Deploy | Invoke | DeployAndInvoke`, so **a paymaster cannot carry a
DECLARE**, which is exactly what publishing the registry class needs.

Resolved by the account holder, in this order:

1. The counterfactual OpenZeppelin account was deployed on mainnet
   (`0x335b7e3776454e9960517a97fbde222133a5ab0ea70d25fde9629172a706062`,
   block 13,814,304), funded with a small amount of STRK for that one fee.
2. `scripts/send-recovery-eth.ts` moved 0.0009 ETH out to a wallet that could
   trade it. The script hard-codes source, destination and amount, refuses on
   the wrong chain or a mismatched address, and defaults to a dry run.
3. The holder swapped that ETH for STRK and returned it. This agent does not
   execute trades or transfers, so the swap and the `--send` step were run by
   the account holder.

Balance before the deployment, agreeing across three RPCs: **21.8953 STRK**.
Declare plus deploy cost 4.0465 STRK, leaving 17.8488 STRK.

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

## Screening: optional in the ABI, and not the first guard

Read from the live mainnet pool:

| Call | Value |
| --- | --- |
| `get_version` | `2.0` |
| `get_screener_public_key` | set, non-zero (`0x501cc452…`) |
| `get_fee_amount` | `6.0 STRK` per pool operation |

An earlier revision of this document concluded that screening was mandatory on
every route and that self-hosting a prover was therefore pointless. **That
conclusion was wrong, and is retracted.** The live ABI says otherwise:

```
apply_actions(
  actions:   Span<privacy::actions::ServerAction>,
  screening: Option<privacy::snip12::ScreeningAttestation>,
)
```

The attestation is an **`Option`**, not a required argument.

Probed read-only against the live mainnet pool, passing `None` for screening
and an empty action list:

| Calldata | Revert |
| --- | --- |
| `["0x0", "0x1"]` (empty actions, screening `None`) | `EMPTY_PROOF_FACTS` |
| `["0x0", "0x0", "0x0", "0x0"]` (screening `Some`, short) | `Failed to deserialize param #2` |

`None` deserializes cleanly and the call proceeds until it fails on the
**proof**, not on screening. So the pool does not reject an unscreened call out
of hand. Whatever screening rule exists is applied after proof validation and,
on the evidence available, conditionally on the action.

What this does and does not establish:

- **Established:** screening is not an unconditional precondition, and the
  first and binding guard is proof validity.
- **Not established:** whether a `Deposit` action specifically requires
  `Some(attestation)`. That check sits behind proof validation, so it cannot be
  reached by a read-only probe.
- **Not established:** whether `SetViewingKey` (registration) or an
  intra-pool transfer requires one. Neither moves value in from outside, which
  is what screening exists to police, and nothing in the ABI or the reachable
  revert path requires an attestation for them.

Self-hosting is therefore **still open**, not rejected. The prover crate is
open source at `starkware-libs/sequencer/crates/starknet_transaction_prover`.
The question it turns on is whether a self-produced proof satisfies the pool's
fact registry for pool version 2.0, which is the next thing to test, not
whether an attestation can be obtained.

Also worth recording for budgeting: at 6 STRK per pool operation, three
live-pool transactions cost **18 STRK in pool fees alone**, before gas. The
deployer holds 17.85 STRK, so funding is close but not yet sufficient for the
full three.

## A useful discovery: `compile_and_panic`

The pool exposes:

```
compile_and_panic(user_addr, user_private_key, client_actions: Span<ClientAction>)
```

It compiles client actions into server actions and panics with the result, so
the compilation step can be inspected read-only, with no prover and no
transaction. It takes a private key, so it is only ever safe with a throwaway
account, and no key belonging to this project has been or will be passed to it.
It is recorded here because it is the cheapest way to validate the action
encoding ahead of a real write.

## The indexer is not a blocker

Removed from this list after checking. The SDK ships
`ContractDiscoveryProvider`, which reads the pool directly over RPC with no
hosted indexer, and the factory documents `new ContractDiscoveryProvider(pool)`.

Lens does not need it either way: `read.ts` and `channels.ts` already walk the
pool over plain RPC, which is the same approach. No indexer dependency exists or
is planned.

## What would unblock it

Any one of:

1. A proving service URL for mainnet.
2. A self-hosted prover whose output satisfies the pool's fact registry for
   pool version 2.0. Open, per the section above, and the cheapest thing left
   to test.
3. A Wallet API method letting a dapp use the wallet as a proving backend for
   an SDK-built transaction, which does not exist.

The fallback still worth pursuing, unchanged: Lens registration, then a Ready
screened deposit, then a Ready private transfer into a Lens-registered address,
then Lens inbound ECDH recovery. It only needs the registration write to
succeed, which is the smallest write the pool accepts and the one least likely
to need an attestation.

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
| Deploy the registry | `npx tsx scripts/deploy-registry.ts --mainnet` | **done**, see above |
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
| Lens deployer | `0x47366fff6d7da5f313cf6a379f460c8544db248231a532e533afd588d801aca` | mainnet, deployed, 17.85 STRK |
| Sepolia deployer | `0x56d8c42a83dc976ea0bf367639c0b5ce4f42ea262ae8d1a046f710e13659124` | sepolia, funded by faucet |

Secrets live only in `.env.local`, which is gitignored and confirmed ignored.
No key, signature or proof fragment appears in this document or any other.

---

# What `strk20.json` contains

Two confirmed mainnet transaction hashes and one mainnet contract address, all
of them the Lens disclosure registry: its declare, its deploy, and the deployed
contract.

Stated plainly so nothing is read as more than it is: **these are Lens registry
transactions, not STRK20 pool transactions.** The pool count is still 0 of 3,
as recorded at the top of this document. Nothing Sepolia and nothing predicted
appears in that file.
