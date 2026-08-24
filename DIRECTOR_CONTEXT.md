# Director context

Evidence-based snapshot of the repository as it exists at commit `1d1fd06`.
Every "working" or "tested" claim below was re-run during this capture. Where
something was not exercised, it says **UNVERIFIED** rather than guessing.

The single most important fact: **the disclosure engine is complete and tested,
and no user interface reaches it.** The site that builds and deploys today is
still the previous product.

---

## A. Project in one paragraph

Lens is a selective disclosure layer for STRK20 private payments. STRK20 makes
payments private; when someone legitimately needs proof, the protocol's only
sharing mechanism is the master viewing key, which reveals the holder's entire
financial history forever and cannot be scoped or withdrawn. Lens narrows that
to one payment relationship: a Holder hands a Verifier the channel keys for a
single counterparty relationship, the Verifier checks it against Starknet with
no wallet and no account, and an on-chain registry records that the Holder
authorized it. It is STRK20-specific because the unit of scope is STRK20's own
channel primitive, and because the pool's public `channel_exists` is what proves
whose payments a disclosure actually shows.

**Not yet true of the product:** there is no interface, nothing is deployed, and
no disclosure has ever been created or verified end to end.

## B. Current user workflow

### What actually works today, in a browser

1. Open `/`, read a static editorial page about STRK20 leak surfaces.
2. Open `/vault`, connect a Ready wallet.
3. The app reads the connected address's public `Deposit` and `Withdrawal`
   events from the pool and lists them.
4. It grades a planned shield/send/unshield as quiet, noisy or loud.
5. It offers a "quieter path" rewrite: wait, split, change amount.
6. Optionally sign a shield/transfer/unshield through the Wallet API.
7. Open `/protocol`, read a static hidden-versus-visible table.

That is the **previous product** (a privacy leak scorer). It has nothing to do
with disclosure. No route in the application imports `session`, `channels`,
`claim` or `bundle`, verified by grep.

### Intended final workflow

| Stage | Status | Why |
| --- | --- | --- |
| Request (Verifier, no wallet) | **NOT BUILT** | `Request` type, commitment and link encoding exist in `src/core/bundle.ts`; no route, no form |
| Holder opens request | **NOT BUILT** | no `/request/[id]` route |
| Wallet connection | **PARTIAL** | wallet connect exists in the old `/vault`; not wired to a disclosure flow |
| Relationship discovery | **PARTIAL** | `resolveRelationship` implemented and unit tested; never run against a live pool |
| Consent preview | **NOT BUILT** | `exposure()` in `src/core/claim.ts` produces the warnings; nothing renders them |
| Authorization (on-chain) | **BLOCKED** | contract compiles, no deployment, mainnet deployer has 0 STRK |
| Disclosure sharing | **NOT BUILT** | see section I, transport is undecided |
| Walletless verification | **PARTIAL** | `verifyDisclosure` implemented and tested against a fake pool; no page, never run live |
| Revocation | **BLOCKED** | contract function exists; no client code, nothing deployed |

## C. Architecture

Actual, as built:

```
Starknet wallet
   │  one SNIP-12 signature
   ▼
src/core/session.ts ......... viewing key, memory only          DONE
   ▼
src/core/derive.ts .......... channel keys, note ids, unmasking DONE
   ▼
src/core/channels.ts ........ outbound derive + inbound ECDH    DONE (offline only)
   ▼
src/core/read.ts ............ public pool views, no signer      DONE (live-read tested)
   ▼
src/core/claim.ts ........... bind identity, walk lanes, verdict DONE (fake pool only)
   ▼
src/core/bundle.ts .......... canonical commitment, links       DONE
   ▼
cairo/src/lib.cairo ......... registry authorize/revoke/status  BUILDS, NOT DEPLOYED
   ▼
(no client) ................. registry reads/writes             NOT BUILT
   ▼
(no page) ................... walletless verifier               NOT BUILT
```

| Path | Responsibility | Status |
| --- | --- | --- |
| `src/core/session.ts` | derive viewing key from one signature | DONE, 14 tests |
| `src/core/derive.ts` | Poseidon derivations, amount unmasking | DONE, 14 tests, matches Cairo vectors |
| `src/core/channels.ts` | both lane directions, ECDH recovery | DONE, 7 tests, never run live |
| `src/core/read.ts` | pool view calls | DONE, 6 tests, live-read proven via doctor |
| `src/core/claim.ts` | identity binding, verdict, exposure text | DONE, 14 tests |
| `src/core/bundle.ts` | request/disclosure types, commitment, links | DONE, 25 tests |
| `cairo/src/lib.cairo` | registry | compiles, undeployed |
| `scripts/doctor.ts` | live health check | DONE, passing |
| `scripts/account.ts` | deployer keys, both networks | DONE |
| `scripts/faucet.ts` | sepolia proof-of-work faucet | DONE, used successfully |
| `scripts/deploy-registry.ts` | declare + deploy | written, **never executed successfully** |
| `src/app/**` | entire frontend | OLD PRODUCT |
| `src/core/{detect,decide,rewrite,fetch,fixture,clock,types}.ts` | leak scorer | OLD PRODUCT, still reachable |

## D. Role model

| Role | Types | Business logic | Contract | UI | Tests |
| --- | --- | --- | --- | --- | --- |
| **Holder** | yes, `Scope.holder`, `Session` | yes | yes, `Authorization.holder`, caller of `authorize` | n/a | yes |
| **Counterparty** | yes, `Scope.counterparty` | yes | **deliberately absent** | n/a | yes |
| **Verifier** | implicit: whoever runs `verifyDisclosure` | yes, holds no keys by construction | n/a, never a caller | n/a | yes |

Correctly separated in types, logic and tests. Not represented in UI because
there is no UI. The Counterparty is intentionally not stored on chain (see J).

## E. STRK20 integration

### REAL STRK20 INTEGRATION

| primitive | used in | purpose | network | working | tested |
| --- | --- | --- | --- | --- | --- |
| `get_note` | `read.ts` | read a note's packed payload | both | yes, anonymous call proven | yes, live via doctor |
| `nullifier_exists` | `read.ts` | spent check, **not** used as evidence | both | yes | yes, live via doctor |
| `get_public_key` | `read.ts`, `claim.ts`, `channels.ts` | read a registered viewing public key | both | UNVERIFIED live | unit only |
| `channel_exists` | `claim.ts`, `channels.ts` | bind a key to a named sender/recipient pair | both | UNVERIFIED live | unit only |
| `subchannel_exists` | `claim.ts` | bind the asset | both | UNVERIFIED live | unit only |
| `get_num_of_channels` | `read.ts`, `channels.ts` | enumerate inbound lanes | both | UNVERIFIED live | unit only |
| `get_channel_info` | `read.ts`, `channels.ts` | fetch the encrypted lane record | both | UNVERIFIED live | unit only |
| `get_version` | `doctor.ts` | pool liveness | both | yes, returns `2.0` | yes |
| Note id / nullifier / channel key / subchannel derivations | `derive.ts` | locate and open notes | n/a | yes | yes, against Cairo's own generated vectors |
| Note amount unmasking, `salt·2^128 + encAmount` | `derive.ts` | recover amounts | n/a | yes | yes |
| ECDH inbound channel decryption | `channels.ts` | recover a lane the Counterparty opened | n/a | yes, round-trips | yes, offline |
| Signature-derived viewing key | `session.ts` | obtain a key without asking for one | n/a | yes | yes |
| Wallet API `strk20InvokeTransaction` | `src/lib/strk20.ts`, old `/vault` | shield/transfer/unshield | mainnet-capable | UNVERIFIED | no |
| Pool `Deposit` / `Withdrawal` events | `src/core/fetch.ts`, old `/vault` | leak scoring | mainnet | UNVERIFIED | fixture only |

### LOCAL / MOCK / SIMULATED

- Every `claim.ts` and `read.ts` test runs against an in-memory fake pool built
  with the same packing, not a node.
- `channels.ts` is proven by round-tripping our own `encryptChannelInfo`, not by
  reading a lane a real Counterparty opened.
- `fixtures/sample-history.json` drives the old leak scorer offline.

### Not used at all

Shielded balance reads (`strk20Balances`), private transfers created by us,
anonymizer contracts / `privacy_invoke`, private sub-accounts, the Privacy SDK,
and any proving service. **No proof has ever been generated by this project.**

## F. Exact privacy guarantee

**What the Holder reveals:** for one Counterparty and one asset, in the included
directions, every payment in that lane: amounts and creation order. Plus the
channel key or keys themselves.

**What remains hidden:** the master viewing key, every other counterparty and
relationship, relationships in other assets, and the Holder's balance.

**Reusable secrets the Verifier receives:** the channel key per disclosed lane.
**Yes, these reveal future activity.** A retained key continues to open that
relationship, including payments made after the disclosure was created. This is
the MVP's central limitation.

- Relationship-scoped, **not** payment-scoped.
- Both directions supported in code; only one asset per disclosure.
- The Verifier **cannot** learn the balance and **cannot** discover unrelated
  counterparties.
- Revocation **cannot** erase revealed data or disable a retained key.

Selective disclosure, explicitly **not** zero knowledge.

## G. Disclosure snapshot

**There is no snapshot.** The current model hands over a live key. A Verifier
re-running verification later sees the lane as it is *then*, not as it was when
the Holder approved.

- Included: whatever the lane contains at read time.
- Frozen: nothing. `createdAt` and `assertedTotal` are committed, so a *changed*
  total causes verification to fail, but the underlying lane keeps growing.
- Future payments: visible to anyone holding the key.
- UI distinction between authorized history and later activity: **not
  implemented**, because there is no UI.

Bounded snapshot disclosure is documented as future work in README and
THREAT_MODEL. Nothing is built.

## H. Disclosure format

- Scheme: `lens-disclosure-v1` (`DISCLOSURE_SCHEME`), requests use
  `lens-request-v1`.
- Hash: Poseidon (`poseidonHashMany`), domain tag `LENS_DISCLOSURE:V1`.
- Canonical field order, fixed in `disclosureCommitment`: tag, scheme, chainId,
  pool, requestCommitment, holder, counterparty, token, direction count,
  direction codes, keys in direction order, assertedTotal, createdAt.
- Direction ordering: always `outbound` then `inbound`; codes 1 and 2.
- Asset: a single token contract address felt.
- Note identifiers: **not included.** Notes are located by walking indices from
  the channel key, so the commitment binds the key rather than a note list.
- Timestamps: `createdAt` unix seconds in the commitment; on-chain
  `created_at` is the block timestamp.
- Serialisation for transport: JSON then base64url, no padding.
- Unknown scheme is refused, never guessed.

Sanitized example:

```json
{
  "scheme": "lens-disclosure-v1",
  "chainId": "0x534e5f4d41494e",
  "pool": "0x040337b1...812a",
  "requestCommitment": "0x<poseidon>",
  "scope": {
    "holder": "0x<holder address>",
    "counterparty": "0x<employer address>",
    "token": "0x053c9125...68a8"
  },
  "directions": ["inbound"],
  "keys": { "inbound": "0x<CHANNEL KEY, SECRET>" },
  "assertedTotal": "9200",
  "createdAt": 1756000000
}
```

## I. Secret transport

**NOT IMPLEMENTED.**

No transport exists. `encodeLink` produces a base64url string and nothing
consumes or transmits it.

Audited by grep across `src` and `scripts`:

| Sink | Secrets present today |
| --- | --- |
| URL path | no |
| Query parameters | no |
| URL fragment | no |
| HTTP requests | no, there is no server and no `fetch` in `src` |
| Backend logs | no backend exists |
| Analytics | none installed |
| localStorage / sessionStorage / cookies | no usage anywhere in `src` |
| Server database | none |
| Browser console | no `console.log` in `src`; only in `scripts` CLI output, which prints addresses, never keys |
| Downloadable files | none |

Private keys exist only in gitignored `.env.local`, read by `scripts/*`.
`git check-ignore` confirms `.env.local` is ignored.

**Open design decision for the director:** a disclosure link contains channel
keys. If it is ever placed in a URL, a fragment is mandatory so it is not sent
to a server, and even then it lands in browser history. This is unresolved.

## J. Registry contract

- Source: `cairo/src/lib.cairo`, module `LensRegistry`, package `lens_registry`,
  Scarb 2.18.0, builds clean.
- Storage: `Map<felt252, Authorization>` where
  `Authorization { holder: ContractAddress, created_at: u64, expires_at: u64, revoked_at: u64 }`.
- Public functions: `authorize(commitment, expires_at)`, `revoke(commitment)`,
  `get_authorization(commitment)`, `status(commitment)`, `is_authorized(commitment)`.
- Events: `DisclosureAuthorized { commitment (key), holder (key), created_at, expires_at }`,
  `DisclosureRevoked { commitment (key), holder (key), revoked_at }`.
- Status enum: `Unknown | Active | Revoked | Expired`.
- Duplicate handling: `authorize` reverts on an existing commitment, so records
  are immutable and cannot be backdated.
- Ownership: `revoke` is holder-only and once-only. Expiry must be in the future
  or zero.

**Publicly visible on chain:** the commitment (a hash), the Holder's address,
three timestamps.

- **Is the Counterparty publicly stored?** No. Deliberate: it is already bound by
  the commitment, and publishing it would leak the shape of a Holder's
  relationships to anyone reading the registry.
- **Can observers enumerate every Holder disclosure?** **Yes.** `holder` is an
  indexed event key, so anyone can list how many disclosures an address has
  authorized and when. They learn the count and timing, not the counterparties.
  This is a real metadata leak and is **not currently documented in
  THREAT_MODEL.md.**
- **Can the Holder reconstruct their history in a fresh session?** Partially.
  They can enumerate their own `DisclosureAuthorized` events and read status, but
  a commitment is a hash: without the original disclosure they cannot recover
  which counterparty it referred to. See K.

## K. Disclosure discovery

**UNRESOLVED.** This is a genuine design gap the director must decide.

The chain gives the Holder: their commitments, timestamps and statuses. It does
not give them the scope, because the commitment is a preimage-hiding hash and
the counterparty is deliberately not stored.

So after a browser restart, cleared state, or on another device, a
`/disclosures` dashboard could list "you have 3 active disclosures" but could
not say what any of them were about.

Options, none implemented:

1. Re-derive candidates by walking the Holder's channels and recomputing
   commitments for plausible scopes. Only works if every field is guessable,
   which `createdAt` is not.
2. Encrypt a scope hint to the Holder's own key and store it on chain or in the
   event. Costs metadata and gas.
3. Local storage of a scope index, which breaks the "another device" case and
   introduces the persistence we have so far avoided.
4. Accept the limitation and show an opaque list.

## L. Verification model

### ON-CHAIN / CRYPTOGRAPHICALLY VERIFIED

- The channel key belongs to that exact sender/recipient pair in that direction
  (`channel_exists`, so the pool attests it).
- The asset lane exists (`subchannel_exists`).
- Each amount, unmasked from immutable WriteOnce note storage.
- Both parties' registration, via `get_public_key`.
- Holder authorization, creation timestamp, expiry and live status, once the
  registry is deployed and a client exists. **Currently neither.**
- Commitment integrity: recomputed locally and compared to the chain. **Client
  code not written.**

### INFORMATION CONTAINED IN THE DISCLOSURE

- Which relationship the Holder chose to reveal, and therefore which they chose
  not to.
- `assertedTotal`, which is checked against the chain and can only fail, never
  add information.
- `requester` and `purpose` free text: unverified strings.
- The claim that this is a complete picture. **It is not, and cannot be.** A
  disclosure proves payments happened, never that others did not.

## M. Revocation and expiry

```
REVOKED means:
  the Holder called revoke() and the chain records who and when;
  anyone checking status sees Revoked;
  the Holder has publicly withdrawn authorization.

REVOKED does NOT mean:
  the Verifier forgets anything;
  screenshots or saved copies stop existing;
  a retained channel key stops decrypting that relationship;
  future payments in that lane become unreadable to a key holder.

EXPIRED means:
  the block timestamp passed the expires_at the Holder set;
  status() returns Expired without any further transaction.

EXPIRED does NOT mean:
  any key stopped working;
  any information became unavailable.
```

**Retained channel keys continue to work indefinitely.** Confirmed by
construction: nothing in the protocol rotates or invalidates a channel key.

## N. Current frontend

| Route | Purpose | Status | Verdict |
| --- | --- | --- | --- |
| `/` | leak-scorer landing, hero plus fixture card | builds, static | **REBUILD** |
| `/protocol` | hidden-versus-visible spec tables | builds, static | REBUILD or fold into docs |
| `/vault` | connect wallet, scan public edges, grade an action, sign STRK20 actions | builds, functionality UNVERIFIED live | **REMOVE** from the product surface |
| `/_not-found`, `/icon.png` | framework defaults | fine | KEEP |

Intended routes:

```
/                 exists, but as the wrong product
/request/[id]     DOES NOT EXIST
/proof/[id]       DOES NOT EXIST
/disclosures      DOES NOT EXIST
```

Components present: `Shell.tsx`, `LeakSheet.tsx`, `Receipt.tsx`,
`RevealHeading.tsx`, `TokenIcons.tsx` (imported by nothing),
`client/WalletHandle/SelectWallet.tsx`, wallet and provider contexts.

Visual state: a light editorial "paper briefing" design per `DESIGN.md`,
applied to the old product. None of the disclosure interface exists, including
the consent preview and the side-by-side privacy boundary, both of which are
specified in `PLAN.md` and `docs/PRODUCT.md` and are **specification only**.

## O. Old product surfaces

| Path | What it does | Imported | Reachable | Safe to remove |
| --- | --- | --- | --- | --- |
| `src/core/detect.ts` | flags leak patterns in history | yes, by `/vault`, `index.ts`, tests | yes | after `/vault` goes; `exposure()` may want its phrasing |
| `src/core/decide.ts` | grades quiet/noisy/loud | yes | yes | with `/vault` |
| `src/core/rewrite.ts` | suggests wait/split/amount | yes | yes | with `/vault` |
| `src/core/fetch.ts` | reads Deposit/Withdrawal events | yes | yes | with `/vault` |
| `src/core/fixture.ts` | loads offline sample history | yes, also by doctor and `/` | yes | **no**, doctor asserts on it |
| `src/core/clock.ts` | time helpers | yes | yes | keep, tiny and generic |
| `src/core/types.ts` | old product types | yes, widely | yes | needs splitting, not deleting |
| `src/app/page.tsx`, `/protocol`, `/vault` | old UI | routed | yes | rebuild |
| `src/app/components/{LeakSheet,Receipt,RevealHeading}.tsx` | old UI parts | yes | yes | with the pages |
| `src/app/components/TokenIcons.tsx` | icons | **no importer found** | no | yes |
| `src/lib/strk20.ts` | Wallet API submit helper, `invokeActions` | yes, by `/vault` | yes | keep `submitStrk20`, it will be needed for authorize |
| `fixtures/sample-history.json` | old scorer fixture | yes, doctor | yes | no |
| `docs/DEMO.md`, `docs/HIDDEN-VS-VISIBLE.md` | old demo script and leak table | docs only | n/a | DEMO.md is stale, HIDDEN-VS-VISIBLE is still accurate and linked from README |
| `STRK20_INTEGRATION_PLAN.md` | 2026-08-15 skill output | docs only | n/a | stale, superseded by `docs/READINESS.md` |

Nothing was deleted during this capture, as instructed.

## P. Test coverage

98 tests, 7 files, all passing.

| Area | Tests | File |
| --- | --- | --- |
| Key derivation vs Cairo vectors | 14 | `derive.test.ts` |
| Viewing key from signature, determinism, chain/pool binding, canonical range | 14 | `session.test.ts` |
| STRK20 channels, ECDH inbound recovery, malformed record skip | 7 | `channels.test.ts` |
| Subchannel scan, dense-index termination, lane separation | 6 | `read.test.ts` |
| Role binding, both directions, forgery, empty relationship, exposure text | 14 | `claim.test.ts` |
| Commitment determinism, tampering, scheme rejection, viewing-key absence | 25 | `bundle.test.ts` |
| Old leak scorer | 18 | `detect.test.ts` |

**Missing tests, and their risk:**

- Registry contract: **zero tests.** No Cairo unit tests, no integration test.
  Authorization, revocation, double revocation, wrong holder, unknown
  commitment, expiry are all unexercised in any environment. Highest test gap.
- Live-pool integration: no test reads a real channel or a real note by
  derivation.
- URL/transport leakage: not testable yet, nothing exists.
- Snapshot behaviour: not applicable, no snapshot.
- Frontend: no tests, and no new frontend.
- `exposure()` output is asserted, but the requested-versus-actual range
  computation described in `PLAN.md` is not implemented, so it is untested.

## Q. Mainnet state

```
network:                Starknet mainnet
wallet/deployer:        0x47366fff6d7da5f313cf6a379f460c8544db248231a532e533afd588d801aca
balance:                0.0000 STRK
registry deployed:      NONE
registry address:       NONE
STRK20 pool used:       0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a (read-only, get_version/get_note/nullifier_exists)
real shield:            NONE
real private transfer:  NONE
real channel:           NONE
authorization tx:       NONE
revocation tx:          NONE
other tx hashes:        NONE
```

Sepolia, for completeness:

```
deployer:   0x56d8c42a83dc976ea0bf367639c0b5ce4f42ea262ae8d1a046f710e13659124  deployed, 4.9336 STRK
faucet tx:  0x778e9ffeecdc630701871d2d7abd4a953e2e63dd86abf6a3000c9788afc6e6b
deploy tx:  0x223a1b6862e0414b6e0471dddb69abd96625ff04b288f50b191edb0502b53da
registry:   NOT DEPLOYED (declare failed: fee bounds 10.78 STRK exceeded the 4.93 balance)
```

`strk20.json` is `{transactions: [], contracts: [], demo_video: "", demo_url: ""}`.
Empty by choice, never padded with placeholders.

## R. External blockers

```
blocker:        mainnet STRK funding (~50 STRK, about USD 1.13)
why needed:     declare + deploy the registry, authorize, revoke
what it blocks: every mainnet requirement, strk20.json, the demo
continue?:      yes, UI and client code can be built against sepolia or fakes

blocker:        STRK20 proving service URL (sepolia + mainnet)
why needed:     any build, including registration, goes through .execute({provingBlockId})
what it blocks: creating a real shielded payment, therefore a real relationship
                to disclose, therefore a genuine end-to-end demo
continue?:      partly. Verification needs no prover, but there is nothing real to verify
note:           VITE_PROVING_SERVICE_URL and VITE_INDEXER_URL are literal TODOs in the
                upstream demo env; @avnu/avnu-sdk ships no prover. Ask in the sprint
                Telegram group

blocker:        sepolia STRK for the registry declare
why needed:     declare estimated at ~4.78 STRK against a 4.93 balance, bounds rejected
what it blocks: a sepolia rehearsal of deploy/authorize/revoke
continue?:      yes, or skip sepolia and deploy straight to mainnet, since gas
                prices are identical on both

blocker:        demo hosting (Vercel)
why needed:     the sprint requires a link anyone can open
what it blocks: the public demo requirement
continue?:      yes. An old deployment exists at lens-beige-five.vercel.app serving
                the previous product

blocker:        a second party for a two-sided demo
why needed:     a genuine Counterparty relationship rather than the Holder paying themselves
what it blocks: demo credibility only
continue?:      yes
```

## S. Hackathon requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| STRK20 integration depth (30%) | **PARTIAL** | deep primitives implemented and unit tested; live usage limited to read-only pool views |
| Working mainnet product (30%) | **NOT DONE** | no deployment, no transactions, no interface |
| Innovation (25%) | **PARTIAL** | design and correctness work done; nothing demonstrable |
| Documentation and open source (15%) | **DONE** | README, THREAT_MODEL, PRODUCT, READINESS, cairo README, Apache 2.0 |
| Three mainnet transactions | **BLOCKED** | funding |
| Public demo | **NOT DONE** | old deployment serves the previous product |
| `strk20.json` | **NOT DONE** | empty, correctly so |
| Demo video | **NOT DONE** | `docs/DEMO.md` describes the old product |

## T. Current repository state

```
branch:            main
HEAD:              1d1fd0630b04465156393a8788fc90a94178d4cd
git status:        clean (before this file was added)
untracked files:   none
modified files:    none
pushed:            yes, origin/main == HEAD, confirmed by git ls-remote
```

Recent commits: `1d1fd06` docs, `99c0ad1` identity model and revocation
semantics, `e0c529a` bundle format, `0229a2c` session keys, `175fe1b` product
model and readiness, `55626e3` mainnet account support, `374ebe9` faucet,
`55cc0ab` registry contract.

### Health check results, re-run for this capture

| Check | Result |
| --- | --- |
| `npm test` | **PASS**, 98 tests, 7 files |
| `npx tsc --noEmit` | **PASS**, exit 0 |
| `npm run build` | **PASS**, 5 routes prerendered, 3.1 min |
| `npm run lint` | **FAIL**, `next lint` reports `Invalid project directory provided, no such directory: .../lint`. Broken script, no linting is running |
| `scarb build` | **PASS** |
| `npm run doctor` | **PASS**, both pools live, derivations match Cairo vectors |

## U. Top technical risks

| # | Pri | Risk |
| --- | --- | --- |
| 1 | **P0** | No user interface reaches the disclosure engine. With nine days left, the entire product surface is unbuilt while the site still ships the old product |
| 2 | **P0** | Nothing on mainnet. The heaviest criterion currently scores zero and is blocked on a one-dollar transfer |
| 3 | **P0** | The registry has zero tests and has never executed anywhere. It could be wrong in a way nothing would catch until deploy day |
| 4 | **P0** | No real STRK20 payment has ever been created, so relationship discovery has never met real data. Live behaviour of `get_channel_info` and ECDH recovery is UNVERIFIED |
| 5 | **P1** | Secret transport is undesigned. A careless implementation puts channel keys in a URL path or query string and leaks them to servers and history |
| 6 | **P1** | `/disclosures` has no recoverable source of truth. A Holder cannot tell what their own commitments refer to after clearing state |
| 7 | **P1** | The registry leaks per-Holder disclosure counts and timing via indexed events, and THREAT_MODEL does not mention it |
| 8 | **P1** | `npm run lint` is broken, so no linting has run on any of this code |
| 9 | **P2** | Old product code is still routed and will confuse a judge browsing the deployed site |
| 10 | **P2** | `docs/DEMO.md` and `STRK20_INTEGRATION_PLAN.md` describe the previous product and contradict the README |

## V. Remaining build work

**P0, required for a submission**

- Registry client: authorize, revoke, status reads
- Deploy the registry to mainnet, record the address
- `/request` composer, no wallet
- `/request/[id]` Holder flow: connect, sign, discover, preview, approve
- Consent preview rendering, including requested-versus-actual range
- `/proof/[id]` walletless verifier with the two-column verified-versus-asserted split
- Decide and implement secret transport
- Three mainnet transactions and `strk20.json`
- Remove or gate the old routes so the deployed site is the new product
- Cairo tests for the registry

**P1, important for judging**

- `/disclosures` with an honest answer to the discovery problem
- Side-by-side privacy boundary visual
- Live integration test against a real relationship
- Four states on every flow: loading, success, empty, error
- Demo video and a rewritten `docs/DEMO.md`
- Fix `npm run lint`
- Document the registry enumeration leak in THREAT_MODEL

**P2, polish**

- CLI verifier so proofs outlive the site
- Copy-full-address affordances, address truncation component
- Delete `TokenIcons.tsx` and other dead components
- Retire `STRK20_INTEGRATION_PLAN.md`

**P3, post-hackathon**

- Bounded snapshot disclosure replacing the reusable key
- Multi-asset disclosures
- Embeddable proof button for other STRK20 apps

## W. Recommended next milestone

**Milestone: the registry client plus a deployed contract, proven by a real
authorize and revoke on chain.**

**Why next.** It is the shortest path from zero to a scoring mainnet product,
and it unblocks three P0 items at once: the registry has never run anywhere, so
it carries unknown risk that only shrinks by executing it; `/proof/[id]` cannot
be built without status reads; and it produces the first two of the three
required mainnet transactions. It also does not depend on the proving service,
which is the blocker most likely to stay unresolved.

Building UI first would be building against an untested contract.

**Files likely affected:** new `src/core/registry.ts` (authorize, revoke,
status, event lookup), `src/utils/constants.ts` (registry addresses),
`scripts/deploy-registry.ts` (execute it), `cairo/address.md`, `strk20.json`,
new `cairo/tests/` or a scripted integration test, `scripts/doctor.ts` to
include a registry check.

**Expected user-visible result:** none yet. The visible artefact is a deployed
contract address, two mainnet transaction hashes, and a doctor line reading
`ok registry status`.

**Tests required:** registry authorize, duplicate rejection, revoke by holder,
revoke by non-holder rejected, double revoke rejected, unknown commitment
returns Unknown, expiry in the past rejected, status transitions.

**Dependencies and blockers:** ~50 STRK to
`0x47366fff6d7da5f313cf6a379f460c8544db248231a532e533afd588d801aca`. Nothing
else. Not blocked by the proving service.

---

## Critical code excerpts

### Viewing key derivation entry point, `src/core/session.ts`

```ts
export function viewingKeyMessage(chainId: string, poolAddress: string): string
export function foldToViewingKey(r: bigint | string, s: bigint | string): bigint
export function deriveViewingKeyFromPrivateKey(
  privateKey: string, chainId: string, poolAddress: string): bigint
export function viewingKeyTypedData(chainId: string, poolAddress: string)
export function viewingKeyFromWalletSignature(signature: string[] | bigint[]): bigint
export function sessionFromSignature(
  address: string, chainId: string, pool: string,
  signature: string[] | bigint[]): Session

// Session is memory-only; nothing here writes to storage.
export type Session = {
  address: string; chainId: string; pool: string;
  viewingKey: bigint; publicKey: bigint;
};
```

The fold matches the pool's `is_canonical_key` (`1 <= k < ORDER/2`) and mirrors
`demo/src/session.ts` in `starkware-libs/starknet-privacy`.

### Outbound channel derivation, `src/core/derive.ts`

```ts
export function computeChannelKey(
  senderAddr: Felt, senderPrivateKey: Felt,
  recipientAddr: Felt, recipientPublicKey: Felt): bigint
// h(CHANNEL_KEY_TAG, sender, senderViewingKey, recipient, recipientPublicKey)

export function computeNoteId(channelKey: Felt, token: Felt, index: number): bigint
export function decryptNoteAmount(
  packedValue: Felt, channelKey: Felt, token: Felt, index: number
): { amount: bigint; salt: bigint }
// packed = salt * 2^128 + encAmount; the salt travels inside the note, so the
// channel key alone is sufficient to read the lane.
```

### Inbound channel recovery, `src/core/channels.ts`

```ts
export function decryptChannelInfo(
  info: EncChannelInfo, holderViewingKey: Felt
): { channelKey: bigint; sender: bigint }
// ECDH: shared = holderViewingKey · ephemeralPubkey, then unmask
// encChannelKey and encSenderAddr with domain-separated Poseidon masks.

export async function findInboundChannel(
  source: ChannelSource, holder: string, counterparty: string,
  holderViewingKey: Felt): Promise<InboundChannel | undefined>
```

### Relationship discovery, `src/core/channels.ts`

```ts
export async function resolveRelationship(
  source: ChannelSource, holder: string,
  holderViewingKey: Felt, counterparty: string): Promise<Relationship>

export type Relationship = {
  holder: string; counterparty: string;
  outboundKey?: bigint;  // derived, then confirmed by channel_exists
  inboundKey?: bigint;   // recovered by ECDH
};
```

### Disclosure creation

**NOT IMPLEMENTED.** No function assembles a `Disclosure` from a
`Relationship`. The type and its commitment exist; the constructor does not.

### Canonical commitment, `src/core/bundle.ts`

```ts
export const DISCLOSURE_SCHEME = "lens-disclosure-v1";

export function disclosureCommitment(d: Disclosure): string {
  const directions = canonicalDirections(d.directions);  // outbound before inbound
  return poseidon([
    textToFelt(DISCLOSURE_TAG), textToFelt(d.scheme),
    toFelt(d.chainId), toFelt(d.pool), toFelt(d.requestCommitment),
    toFelt(d.scope.holder), toFelt(d.scope.counterparty), toFelt(d.scope.token),
    BigInt(directions.length),
    ...directions.map(directionCode),
    ...directions.map((dir) => toFelt(d.keys[dir] ?? 0)),
    toFelt(d.assertedTotal), BigInt(d.createdAt),
  ]);
}
```

### Disclosure verification, `src/core/claim.ts`

```ts
export async function verifyDisclosure(
  reader: NoteReader, scope: RelationshipScope,
  keys: LaneKeys, assertedTotal: bigint): Promise<DisclosureResult>

// For each supplied lane:
//   sender/recipient chosen by direction
//   recipientPublicKey read from the pool, never taken from the disclosure
//   channel_exists(computeChannelMarker(...)) must be true  <- identity binding
//   subchannel_exists(...) binds the asset
//   scanSubchannel walks indices until the first empty slot
// Failures: no-lanes | unregistered-holder | unregistered-counterparty
//         | lane-not-in-pool | no-notes | total-mismatch
```

Note: this does **not** yet check the on-chain commitment or status. That
belongs to the registry client, which does not exist.

### Registry authorization, revocation, status, `cairo/src/lib.cairo`

```cairo
fn authorize(ref self: ContractState, commitment: felt252, expires_at: u64) {
    assert(commitment != 0, Errors::ZERO_COMMITMENT);
    let existing = self.authorizations.entry(commitment).read();
    assert(existing.created_at == 0, Errors::ALREADY_AUTHORIZED);
    assert(expires_at == 0 || expires_at > now, Errors::EXPIRY_IN_PAST);
    // caller becomes holder; emits DisclosureAuthorized
}

fn revoke(ref self: ContractState, commitment: felt252) {
    assert(existing.created_at != 0, Errors::NOT_AUTHORIZED);
    assert(existing.holder == get_caller_address(), Errors::NOT_HOLDER);
    assert(existing.revoked_at == 0, Errors::ALREADY_REVOKED);
    // emits DisclosureRevoked
}

fn status(self: @ContractState, commitment: felt252) -> Status
// Unknown -> Active -> (Revoked | Expired)
```

### Frontend routing, `src/app`

```
src/app/layout.tsx        shell, wallet provider
src/app/page.tsx          OLD leak-scorer landing
src/app/protocol/page.tsx OLD spec tables
src/app/vault/page.tsx    OLD scan/grade/sign console
```

No route imports `session`, `channels`, `claim` or `bundle`. Verified by grep
during this capture.
