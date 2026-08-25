# Sprint facts and machine readiness

Onboarding output. Part A is the sprint and the ecosystem, Part B is the machine.
Every fact is labelled **confirmed** (read on an official source), **inferred**
(implied but not stated), or **unknown** (not found, and where I looked).

## Part A: the sprint

| Item | Value | Status |
| --- | --- | --- |
| Name | STRK20 Private Sprint | confirmed |
| Organiser | StarkWare, judged by a named panel | confirmed |
| Window | 14 to 31 August 2026 | confirmed |
| Deadline | **31 August 2026, 23:59 UTC** | confirmed |
| Winners announced | 4 September 2026 | confirmed |
| Prizes | 2,500 / 1,500 / 1,000 in STRK | confirmed |
| Entry | one PR adding repo and Telegram to `registry.json` | confirmed |
| Submission | nothing to submit; the repo on 31 Aug is what counts | confirmed |
| Required file | `strk20.json` at repo root: demo video, contracts, tx hashes | confirmed |
| Network | **mainnet required**, three mainnet transactions | confirmed |
| Demo | a link anyone can open, not behind a login | confirmed |
| Repo | public, built in public, read every 30 minutes | confirmed |
| Licence | open source expected under the 15% criterion | inferred |
| Team size limit | none stated | unknown, not on the sprint page |
| Video length limit | none stated | unknown, `demo_video` is a field with no spec |

### Judging, which is the specification

| Weight | Criterion | Where we stand |
| --- | --- | --- |
| 30% | STRK20 integration depth | strong: channels, notes, bindings, a Cairo contract |
| 30% | Working mainnet product | registry live on mainnet; pool writes still blocked |
| 25% | Innovation | modest: IDEA-21 is on their list, three teams in the lane |
| 15% | Documentation and open source | strong, already the project's best trait |

Gates before scoring: public repo, mainnet transactions, an openable demo, a
populated `strk20.json`. A gate failure makes every score irrelevant, so gates
come first in the plan.

### Sponsors

**None.** StarkWare is the sole sponsor and runs the judging. There are no
sponsor tracks or bounties to align with, so the sponsor-leverage analysis is a
complete answer at one line: it does not apply here.

### What the ecosystem wants that does not exist

Two published lists. The **RFPs** are what StarkWare wants to exist as startups,
which is the stronger signal. The **IDEAS** list is broader. Ours is IDEA-21,
selective disclosure tooling, with IDEA-22 compliance infrastructure adjacent.

Documented gaps the ecosystem admits to, taken from its own docs:

- **No selective disclosure below a full viewing key.** This is our product.
- Channel-open linkability, distinctive amounts, and rapid in-and-out patterns
  weaken anonymity.
- Edges are public by design.
- Private sub-accounts exist in the SDK but **not** in the Wallet API.
- The Privacy SDK is not on npm, GitHub Packages only.

### Ecosystem in one paragraph

Starknet is an Ethereum layer two. STRK20 adds a shielded pool that any ERC-20
can enter: balances and transfers inside it are encrypted and proven with zero
knowledge, while deposits and withdrawals stay public at the edges. Screening is
applied on deposit and a viewing key permits disclosure under lawful request.
The pitch is privacy that stays compatible with regulation, which is exactly the
seam our product sits in.

### Concepts that matter here, and only here

| Plain meaning | Technical name | Why we care |
| --- | --- | --- |
| A private IOU held in the pool | note | what a disclosure reveals |
| A one-directional lane between two people | channel | the unit of scope |
| The key that decrypts everything you have | viewing key | what we refuse to share or store |
| A shared secret for one lane | channel key | what a disclosure hands over |
| Proof a note was spent | nullifier | cannot be recomputed by a verifier, so not evidence |
| Helper the pool calls atomically | anonymizer, `privacy_invoke` | not used in v1 |
| A second identity with no public link | private sub-account | SDK only, Wallet API pending |

## Part B: the machine

### Audit, as found

| Tool | Version | Status |
| --- | --- | --- |
| Windows | 11, build 22621 | installed |
| Shell | Git Bash and PowerShell | installed |
| Git | 2.53.0 | installed |
| Node | 24.14.0 | installed, meets the SDK's Node >= 24 |
| npm | 11.9.0 | installed |
| TypeScript | 5.9.3 | installed |
| starknet.js | 10.4.0 | installed, project-local |
| Scarb and Cairo | 2.18.0 | **added**, matches the repo pin exactly |
| Privacy SDK | 0.14.3-rc.5 | **not on npm**, source cloned, not yet linked |

Nothing was replaced or upgraded. Scarb was extracted to a user-local directory
rather than installed system-wide, so no other project's toolchain moved.

### Networks

| | mainnet | sepolia |
| --- | --- | --- |
| Pool | `0x0403...812a` | `0x0254...0d91` |
| Version | 2.0, live | 2.0, live |
| RPC | `api.cartridge.gg/x/starknet/mainnet` | `.../sepolia` |
| Fee token | STRK `0x0471...938d` | same |
| Explorer | voyager.online | sepolia.voyager.online |
| Faucet | none, real funds | `scripts/faucet.ts`, proof of work |

The mainnet pool address is **not in the public docs**. It ships as
`PRIVACY_POOL_ADDRESS` in `@avnu/avnu-sdk`.

Two dead endpoints found and removed: all blastapi URLs now return "Blast API is
no longer available", and lava's testnet endpoint returns a provider error. The
old repo defaulted to one of them.

### Keys

Disposable development keys only, in `.env.local`, confirmed ignored by Git
before the first commit. No personal wallet key is used anywhere.

- Sepolia deployer `0x56d8...9124`, deployed, funded 5 STRK by faucet.
- Mainnet deployer `0x4736...1aca`, **deployed and funded**. Held 21.90 STRK,
  spent 4.05 on the registry declare and deploy, 17.85 left. Nothing personal
  has ever been in it.

### Smoke test

Run `npm run doctor`. Latest result, all passing:

- both pools answer `get_version` with 2.0
- `get_note` on an unwritten note reads zero rather than reverting, on both
- `nullifier_exists` answers on both
- our independent derivation matches the Cairo reference vectors for channel
  key, note id and nullifier
- an amount round trips through the real packing
- the offline fixture still scores without a network

Two real transactions have landed on Sepolia: the faucet drip and the account
deployment.

### Status: READY WITH WARNINGS

The toolchain is proven against reality, not against version numbers. Three
named items are unresolved:

1. **The proving service.** Resolved: the deployer is funded and the registry is
   live on mainnet. What remains is the prover, which blocks pool writes only.
   At 6 STRK per pool operation, three pool transactions cost 18 STRK in fees
   alone, slightly more than the 17.85 STRK left.
2. **Privacy SDK is not linked.** Cloned from source, not yet built into the
   project. Needed to create payments, not to verify them.
3. **Signature-derived viewing key is unreproduced.** The pattern is confirmed in
   StarkWare's own bridge; our implementation of it does not exist yet. This is
   the load-bearing assumption for the product and is the next thing to verify.

## Reproducibility

Commands actually run, not remembered:

```bash
npm install
npx tsx scripts/account.ts --new          # sepolia key into .env.local
npx tsx scripts/faucet.ts                 # proof-of-work faucet drip
npx tsx scripts/account.ts --deploy
cd cairo && scarb build                   # scarb 2.18.0
npm test                                  # 47 tests, offline
npm run doctor                            # live checks, both networks
```

Scarb was installed by downloading
`scarb-v2.18.0-x86_64-pc-windows-msvc.zip` from the official releases and adding
its `bin` to `PATH`. On Linux or macOS, `asdf install scarb 2.18.0`.
