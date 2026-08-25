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

Required by the sprint, quoting its README: "Three mainnet transaction hashes in
`strk20.json`, each proving a real call against the STRK20 pool." Registry
declare, registry deploy, and Lens authorize and revoke do not count.
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

## Production is on mainnet

`https://lens-beige-five.vercel.app` rebuilt from the deployment commit and now
ships the mainnet registry. Checked, not assumed:

| Check | Result |
| --- | --- |
| Registry address in the served client bundle | found in `/_next/static/chunks/326-2008cf66c70ea382.js` |
| Chain read from the production origin | `0x534e5f4d41494e`, SN_MAIN |
| `status(unknown commitment)` from that origin | `0x0`, Unknown |
| `is_authorized(unknown commitment)` from that origin | `0x0`, false |
| Console errors on the proof page | none |

Two proof pages were loaded against the live site:

- A link with the fragment stripped renders **CANNOT VERIFY** and explains that
  the part after `#` was lost, rather than guessing.
- A well-formed disclosure naming the mainnet chain and pool renders
  **VERIFICATION FAILED**, with the reason: the holder has never registered
  with the pool, so nobody could have paid them privately. The page reads the
  real mainnet pool to reach that answer, and shows nothing about the amounts.

That second disclosure was built from the test fixture purely as a verification
input. It was **not** authorized, and no authorization exists on mainnet.

`/proof` responses carry `Referrer-Policy: no-referrer` and
`Cache-Control: private, no-store`, so the fragment is not leaked onward or
cached.

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

Reduced during this phase from "the SDK route is blocked" to something much
narrower and much better understood.

## How a pool write actually works

Read from `packages/privacy/src/privacy.cairo` at `PRIVACY-0.14.3-RC.2`. A write
is two transactions, not one.

**Phase 1, off chain.** A virtual Invoke V3 is built whose sender is the pool
itself. Its calldata is `(user_addr, user_private_key, client_actions)`.
`__validate__` requires the caller to be the OS, a zero tip, and every
`max_price_per_unit` to be zero, so it is a zero-fee transaction that never
reaches a sequencer. `__execute__` compiles the client actions into server
actions, checks the user's signature over the call set, and messages the result.
That execution is what the prover proves.

**Phase 2, on chain.** A real transaction calls
`apply_actions(server_actions, screening)` carrying the proof facts.

The order inside `apply_actions` is fixed, and it explains the
`EMPTY_PROOF_FACTS` seen earlier: `assert_not_paused`, then `validate_proof`,
then `collect_fee`, then the actions, and only then screening.

## `user_private_key` is the viewing key, and it goes to the prover

`derive_public_key` is `GEN_P().mul(private_key).x()`, and `is_canonical_key` is
`key < ORDER / 2`. Those are exactly the STARK-curve generator multiplication
and the canonical fold that Lens's own `deriveViewingKeyFromPrivateKey`
performs, so `user_private_key` in the calldata above **is the viewing key**.

The SDK confirms it from the other side. `private-transfers.ts` reads
`viewingKeyProvider.getViewingKey()` and passes it into
`proofInvocationFactory.create({ ...account, viewingKey }, ...)`, and that
invocation is what `provingProvider.prove()` sends to the proving service.

**So the SDK route hands the viewing key to whoever runs the prover.** The SDK
ships an OHTTP client, which hides *who* is asking, not *what* is sent.

This is a design fact, not a criticism: the intended operator of a prover is the
wallet that already holds the keys, which is why the Wallet API route exists.
But it does mean that for Lens, whose premise is that a viewing key is never
handed over, a third-party hosted prover is not a neutral convenience.
Self-hosting is the option consistent with what Lens claims.

## Screening, settled from source

Retracting the earlier claim in both directions: it is not required everywhere,
and it is not optional where it does apply. The on-chain rule is four lines
(`privacy.cairo`, `apply_actions`):

```cairo
if let Some(depositor) = self._apply_actions(:actions) {
    // A regular-pool deposit must carry a screening attestation.
    self._verify_screening(screening.expect(errors::SCREENING_REQUIRED), depositor);
} else {
    // No deposit: there must be nothing to screen.
    assert(screening.is_none(), errors::UNEXPECTED_SCREENING);
}
```

`_apply_actions` returns `Some(depositor)` only when the action list contains a
`ServerAction::TransferFrom`, the action that pulls tokens in from a public
address. Every other action returns `None`, and for those an attestation must be
**absent** or the call reverts with `UNEXPECTED_SCREENING`.

The off-chain sidecar agrees. In
`proof-interceptor/src/screening-interceptor.ts`, `getScreenedAddresses`
"returns `[]` for non-pool transactions and for pool transactions that carry no
Deposit action (e.g., Withdraw-only)", and `hasDepositAction` checks
`action.activeVariant() === "Deposit"`. The compatibility matrix calls the
interceptor an "optional deposit-screening sidecar to the transaction prover;
deploy only for screening-enabled pools."

| Action | Attestation | Source |
| --- | --- | --- |
| REGISTER (`SetViewingKey`) | must be absent | no `TransferFrom`, so the `else` branch applies |
| DEPOSIT | **required** | `TransferFrom` sets the depositor |
| TRANSFER (intra-pool) | must be absent | `WriteOnce` and `Append` only |
| WITHDRAW | must be absent | `TransferTo`, and named in the interceptor comment |

The sprint's own `MAINNET-DAY-0.md` says the same in prose: "A compliance
provider screens the depositing address... running your own prover does not
bypass it."

**Consequence:** registration and private transfers need a prover and no
screener. Only a deposit needs a screener, and the Ready route supplies one.

## The live pool does not match the published matrix

| | Class hash |
| --- | --- |
| Live mainnet pool `0x0403...812a` | `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` |
| Published matrix, `PRIVACY-0.14.3-RC.0` | `0x52107fadffab71bdcbb6b2ccb68ba3e1b5558d94036538053e159d3076ad633` |

Read on two RPCs, and they agree. The pool address itself is right: it is the
one the sprint's `MAINNET-DAY-0.md` names.

The mismatch is not resolvable from published material, because
`demo/.env.mainnet.example` still carries `TODO_MAINNET_POOL_ADDRESS` and
`TODO_MAINNET_POOL_CLASS_HASH`. The repository has never published the mainnet
deployment. `packages/privacy/src/privacy.cairo` differs between RC.0, RC.2 and
RC.5, so the matrix hash belongs to a build that is not what mainnet runs.

What is known about the live class: `get_version` is `2.0`, `apply_actions`
takes `Option<ScreeningAttestation>`, `get_screener_public_key` is set, and
`get_proof_validity_blocks` is 450. That is a screening-enabled pool on the
0.14.3 line, not a pre-screening build.

**This is why RC.2 is the candidate rather than RC.5.** All components in a
matrix row are tested together, and RC.2 is the row that is published. It is
also why self-hosting cannot be called proven: the prover re-executes whatever
class is on chain, so a class outside the tested row is an untested combination.

## Compatibility matrix, recorded verbatim

| Component | Pinned revision |
| --- | --- |
| Transaction Prover | `ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2` |
| Proof Interceptor | `ghcr.io/starkware-libs/starknet-privacy/proof-interceptor:PRIVACY-0.14.3-RC.2` (optional, deposits only) |
| Discovery Service | `ghcr.io/starkware-libs/starknet-privacy/discovery-service:PRIVACY-0.14.3-RC.2` |
| Pathfinder | `eqlabs/pathfinder:v0.22.7`, with `PATHFINDER_STORAGE_STATE_TRIES=10000` |
| SDK | `PRIVACY-0.14.3-RC.2` |
| Privacy Pool contract | `PRIVACY-0.14.3-RC.0` |

All three images answer an anonymous ghcr manifest request, so none of them
needs credentials. They publish `linux/amd64` only.

## Self-hosting: specified, and out of reach on this machine

From the prover crate's own README:

| Requirement | Value |
| --- | --- |
| Recommended machine | `c4d-highcpu-48` |
| vCPU | 48 |
| Memory | 96 GB |
| Architecture | amd64 |
| `RPC_URL` | a Starknet node speaking **JSON-RPC v0.10** |
| Port | 3000, JSON-RPC 2.0 on `/` |
| Health check | `starknet_specVersion` returns `0.10.0` |
| Accepts | Invoke V3 only, finalized blocks only, one transaction per request |

Two of those are better news than expected. The prover talks to an ordinary
`RPC_URL`, and both Cartridge and Lava already answer `starknet_specVersion`
with **0.10.2** on mainnet, so a self-run Pathfinder is not obviously required.
And the interceptor is not needed at all for registration, which carries no
deposit.

The blocker is the machine. This machine has **4 vCPU and 15.9 GB of RAM**
against a recommendation of 48 and 96. That is not a tuning gap, and no flag
closes it. Docker is installed, so the constraint really is the hardware.

Nothing has been rented or deployed.

## What is left, stated precisely

Exactly **one** transaction needs a prover Lens controls: Lens's own
registration. Its viewing key has to be the one Lens derives, and
`SetViewingKey` is write-once, so it cannot be delegated to a wallet that would
register its own key instead.

Everything else can go through Ready, which reaches its own proving service:
the screened deposit and both private transfers.

Unblocking therefore needs one of:

1. The hosted mainnet proving URL. The sprint's `MAINNET-DAY-0.md` still says
   "The mainnet proving service URL is not published here yet," and names
   opening an issue as the route to request it.
2. A machine that can run `transaction-prover:PRIVACY-0.14.3-RC.2` for a single
   proof, pointed at a public v0.10 RPC. Specified above, not provisioned.

Self-hosting is **not** rejected, and screening is **not** the obstacle for
registration.

## Discovery, corrected

An earlier note here said the indexer is not a blocker. That is still true for
Lens: `read.ts` and `channels.ts` walk the pool over plain RPC and the app
depends on no indexer.

It is **not** true for SDK-based transaction construction. Per the sprint's own
doc, as of SDK `0.14.3-rc.5` `ContractDiscoveryProvider` is not re-exported from
the package entry and the `exports` map has no `./internal/*` subpath, so it
cannot be deep-imported either. On the SDK route, discovery means a hosted
indexer today.

For a registration-only call this may not bite: the compiler discovers
recipients only when a channel is being opened, and a bare `SetViewingKey` opens
none. That is a reading of `sdk/src/internal/compiler.ts`, not a tested result,
and it is recorded as an assumption rather than a finding.

## The Ready half

`wallet_rpc.json` at spec `v0.10.3` defines three STRK20 methods:
`wallet_strk20InvokeTransaction`, `wallet_strk20PrepareInvoke` and
`wallet_strk20Balances`.

`STRK20_TRANSFER_ACTION.recipient` is documented as "The Starknet address of the
registered recipient inside the privacy pool", typed as a plain `ADDRESS`. There
is no constraint that it be wallet-owned, a wallet contact, or under wallet
custody. **At spec level an arbitrary registered recipient is supported**, and
being registered is the only requirement, which is precisely what Lens's
registration would provide.

What the spec cannot answer is whether Ready implements those methods for a
dapp. There is no published list of STRK20-capable wallets, and the sprint's own
guidance is to probe rather than assume, using the read-only
`wallet_strk20Balances`. The `/probe` route
does exactly that: open it in the browser that has the wallet and it reports
whether the STRK20 methods answer. It signs nothing and submits nothing.

The first attempt at this probe scanned `window` for `starknet_*` keys. It
reported no wallet even with Ready installed, unlocked, and showing the expected
account. **The wallet was there and the probe was wrong.** Wallets announce
themselves through the wallet-standard registry now rather than by leaving an
enumerable global on `window`, so the scan could never have seen it.

The replacement lives at `/probe` and uses `createStore` from
`@starknet-io/get-starknet-discovery`, which is the same discovery the real
`ConnectWallet` uses, so it exercises the path the product itself depends on. No
dependency was added: both get-starknet packages were already in `package.json`.

It is development-only. `next build` prerenders the route to a 404 and the
metadata export was removed so the 404 does not advertise it.

```
npm run dev
```

then open `http://localhost:3000/probe`.

It asks the wallet to connect, which is a normal connection prompt, then reads
identity, `wallet_supportedSpecs`, and the read-only `wallet_strk20Balances`. A
second, separate button checks whether the STRK20 methods exist at all by
sending a deliberately empty action list: the spec requires at least one action,
so the wallet has nothing it could build, prompt for or submit, and the only
thing read is which way it refuses. Nothing is signed, submitted, approved or
moved, and the network is never switched.

Validated in a wallet-free browser: it renders, discovery runs, it reports "No
Starknet wallet announced itself yet", and the console is clean. So a real run
will mean something. It has **not** been run against the wallet, because no
Chrome holding the extension is reachable from here.

The proving plan, the self-host specification and the budget live in
[docs/PROVER_PLAN.md](./PROVER_PLAN.md).

## Budget, from the live contract

`collect_fee()` runs unconditionally inside `apply_actions`, before the actions
and before screening, and moves `get_fee_amount()` in STRK from
`get_caller_address()` to the fee collector. Live value: **6 STRK per pool
operation, every action type, no exceptions.** Because it is a `transferFrom`,
the submitting account must approve the pool for it first, which is an ordinary
ERC-20 call and not itself a pool operation.

| Actor | Holds | Planned pool operations | Pool fees | Headroom |
| --- | --- | --- | --- | --- |
| Lens `0x4736...1aca` | 17.85 STRK | registration | 6 STRK | 11.85 STRK, plus gas and the two registry writes |
| Ready `0x04c7...99c8` | 24.94 STRK | deposit, transfer A, transfer B | 18 STRK | 6.94 STRK, which also has to cover gas and the deposited amount |

Neither account holds USDC, so a STRK-denominated demo is the practical choice.
No top-up is required for the four planned operations, though the deposited
amount has to stay small, on the order of 2 to 4 STRK, to fit inside Ready's
remaining headroom.

# Ready to run the moment it unblocks

| Step | Command | State |
| --- | --- | --- |
| Verify a live relationship | `npx tsx scripts/verify-relationship.ts <holder> <counterparty> --mainnet` | written, exercised against live mainnet reads |
| Deploy the registry | `npx tsx scripts/deploy-registry.ts --mainnet` | **done**, see above |
| Full disclosure lifecycle | `npx tsx scripts/e2e-sepolia.ts` | passing on Sepolia against the live contract |
| Probe the wallet for STRK20 | `npm run dev`, then `/probe` in the browser holding the wallet | written and self-tested, read-only, needs a human at the browser |

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
| Counterparty, Ready side | `0x04c7082c068f3d78d0637c867041e322a33b03ed70606ad4bd8e5771a13f99c8` | mainnet, deployed, 24.94 STRK |
| Sepolia deployer | `0x56d8c42a83dc976ea0bf367639c0b5ce4f42ea262ae8d1a046f710e13659124` | sepolia, funded by faucet |

Secrets live only in `.env.local`, which is gitignored and confirmed ignored.
No key, signature or proof fragment appears in this document or any other.

---

# What `strk20.json` contains

`transactions` is **empty**, and stays empty until a genuine STRK20 pool
transaction exists.

It briefly carried the registry declare and deploy hashes. That was wrong and
has been corrected. The sprint scores that field by checking each hash on chain
for having "touched the STRK20 pool", so a registry hash there is not a
generous reading of the rules, it is an entry that fails the check. A note in
the prose explaining the difference does not fix a manifest that claims the
wrong thing, so the hashes were removed rather than annotated.

`contracts` holds the Lens registry
`0x7e14bc65e5f759da2a981843c485a948dc6e15548fe0ba51e3ca805ca75fb01`, which is
what that field is for: "Deployed addresses, shown with their network."

The registry declare and deploy hashes remain recorded above under
[LENS REGISTRY](#lens-registry), which is the right place for them.
