# Lens, build plan and user workflow

Locked 2026-08-18. Sprint ends 2026-08-31 23:59 UTC.

## The pivot in one line

Lens keeps its name and its repo. It stops being "see what leaks by accident" and
becomes "**reveal exactly one thing on purpose**". A lens narrows the field of
view: everything outside the frame stays dark. The old leak-scoring code is not
thrown away, it becomes the pre-check that runs before anything is shared.

**Product line:** Prove one thing about your STRK20 activity. Nothing else.

## Why this, and not the old Lens

STRK20 gives you two settings today: reveal nothing, or let an auditor decrypt a
key that opens your entire history forward and backward. The docs say it plainly,
no mechanism allows sharing less than a full viewing key. Around 60 of the 79
sprint projects build the private send. Almost nobody builds the way back out.

Verified against the live chain on 2026-08-18, not assumed:

- `get_note(note_id) -> Note{packed_value, token}` is a **public view**. An
  anonymous caller with no wallet read a real note and got
  `0x9a150aa3369a34b9c0a1e053f2dbd95f705f8ef5df3eed6e7322828b1870c3`, matching
  that note's `EncNoteCreated` event exactly. A bogus id returns zero.
- `nullifier_exists(nullifier) -> bool` is public, so a verifier can check spent
  or unspent with no key at all.
- Note cells are WriteOnce, so a disclosure cannot be backdated or rewritten.
- `channel_key = h(CHANNEL_KEY_TAG, sender_addr, sender_priv, recipient_addr,
  recipient_pub)` is a Poseidon output. Handing one over does **not** expose the
  master viewing key.

Design consequence, and it bounds v1: both the note's location and its amount
mask derive from the same `channel_key`, so the smallest sound disclosure unit
without a ZK circuit is **one channel**, meaning one counterparty in one
direction. Not one individual note. We state that in the docs rather than
implying finer granularity than we have.

---

# Part 1, user workflow

Two roles. **Holder** holds shielded activity. **Verifier** needs proof of one
fact: an exchange, an accountant, a landlord, a counterparty, a DAO.

Rule that governs every screen: **the verifier never needs a wallet, an account,
or an install.** Verification is a browser page that reads mainnet. If we break
that, we lose the adoption argument.

## Flow A, verifier asks first

This is the differentiator. Monero proofs, Zcash ZIP 311, and both sprint
competitors are one-way strings the Holder generates and hopes is what was
wanted. Nobody has the request half.

1. **Compose.** Verifier opens `/request`, no wallet. Picks a claim and a scope:
   "prove receipts from `0xABC` between Aug 1 and Aug 18", or "prove shielded
   USDC of at least 10,000". Adds who is asking, and an expiry.
2. **Send.** Lens returns a request link. The verifier sends it however they
   already talk to the person. The request bounds what can be answered, so nobody
   can be talked into oversharing.
3. **Open.** Holder opens the link, connects Ready. Lens derives the channel
   keys for exactly the named scope, **locally in the browser**. No key reaches a
   server, because there is no server in this path.
4. **Pre-check.** Before anything is shared, Lens shows what this disclosure
   exposes and what it does not: "This opens both directions of your lane with
   `0xABC`: 6 notes, including 2 outside the dates you were asked about. It does
   not reveal your balance, your other counterparties, or your viewing key."
   This screen is the old `detect` and `decide` code doing real work.
5. **Approve and anchor.** Holder confirms. Lens builds the bundle (scope,
   claim values, in-scope channel keys, request id, expiry) and signs **one
   mainnet transaction** to the Disclosure Registry, anchoring `hash(bundle)`,
   the requester, and the expiry. The bundle never goes on chain, only its hash.
6. **Return.** The bundle goes back through the link, out of band.
7. **Verify.** Verifier opens `/verify`. The browser computes note ids, calls
   `get_note`, unmasks amounts, checks `nullifier_exists`, then checks the
   registry anchor, the requester, the expiry, and the revocation flag. Green
   panel with the exact claim, or a specific reason it failed.
8. **Revoke.** Any time later the Holder hits Revoke, one mainnet transaction.
   The proof page then shows REVOKED and when. It does not erase what the
   Verifier already saw, and a retained channel key keeps working. This is
   authorization revocation, not access revocation.

## Flow B, Holder sends unprompted

Same pipeline without steps 1 and 2. For "here is your receipt". Produces a
shareable proof link. This is the flow other sprint projects can embed.

## Flow C, embedded in someone else's app

A payment app in this sprint adds a "prove this payment" button. It calls the
Lens SDK with a note reference, gets a link, hands it to its user. This is the
Turbine Cash shape that won the nearest adjacent contest: be the piece other
builders integrate, not another standalone app.

## Claims shipped in v1

| Claim | Question it answers | Soundness |
| --- | --- | --- |
| Relationship | "Did `0xABC` pay me, and how much" | Sound. Identity bound by `channel_exists` |
| Income over a period | "What came in during this window" | Sound. Sum of relationship claims |
| ~~Balance floor~~ | ~~"Do I hold at least N"~~ | **Cut. Not soundly verifiable, see below** |

**Balance floor is cut from v1.** A note's nullifier binds to the owner's
private viewing key, so a verifier cannot recompute one. A supplied nullifier
is therefore an unverifiable assertion: a Holder could hand over any felt
that happens to be absent from the pool and call the note unspent. Proving
"I still hold this" needs a circuit, or the master key we exist to avoid
handing over. `spentStatus` stays in the code as the owner's own view and is
documented as not being evidence. Found on Day 1 while writing `read.ts`,
before anything was built on top of it.

**Identity binding, the piece that makes the rest sound.** A channel key alone
proves only that notes exist at some locations. The pool's public
`channel_exists(channel_marker)` closes it: the marker is computed from the
channel key plus both addresses and the recipient's registered public key, so
if the pool says it exists, the pool is attesting that this key belongs to
that pair in that direction. `subchannel_exists` does the same for the token.
Without this step anyone could fund their own lane and present it as a payment
from someone else, which is covered by a test.

Stretch, only if days remain: **source of funds**, linking a public `Deposit` to
the notes it created. Deferred because it needs the deposit-to-note link, the one
claim not yet proven end to end.

## What Lens will never claim

Carried over from the old `HIDDEN-VS-VISIBLE.md`, because that discipline was the
best thing about the old project:

- A disclosure is scoped, not zero-knowledge. Everything inside the scope is
  revealed in full. We do not call it a ZK proof.
- Channel granularity, not note granularity. Stated on the pre-check screen.
- Revocation withdraws authorization and makes that withdrawal publicly
  checkable. It cannot un-see what someone already read, and a retained channel
  key keeps working. Say so on the revoke button.
- Deposits and withdrawals stay public. Lens does not make them private.

---

# Part 2, build plan

Following the build-process phases: risky core first, tests as we go, verify
against reality, reproducible from the first commit.

## Phase 0, pipeline and the load-bearing module

```
scope.ts   parse and serialize a request and its scope      pure
derive.ts  channel key, note id, nullifier, amount unmask   pure   <-- LOAD BEARING
read.ts    RPC: get_note, nullifier_exists, events          I/O only
claim.ts   scope + reads -> a claim, or a reason it fails   pure, deterministic
expose.ts  what this bundle reveals (old detect/decide)     pure
bundle.ts  build, serialize, hash the bundle                pure
registry.cairo   anchor / revoke / is_valid                 mainnet
```

Routes: `/request`, `/disclose/[req]`, `/verify/[bundle]`, `/disclosures`.

**The load-bearing module is `derive.ts`, and one specific unknown inside it.**
`get_note` returns a single `packed_value` felt, but the docs publish the
`enc_amount` and `enc_token` formulas separately. The packing layout is not
documented. Read it out of the SDK source, do not guess it.

## Phase 1, prove the core before anything depends on it

**Day 1 to 2, and this is a gate.**

1. Pull `@starkware-libs/starknet-privacy-sdk` from GitHub Packages, Node >= 24.
   Read its note decode path.
2. Locate the **mainnet** pool address. It is not in the public docs, only the
   Sepolia v2.0 pool
   `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`. It ships
   as `PRIVACY_POOL_ADDRESS` in the SDK and AVNU packages.
3. Make one real shielded payment to ourselves on Sepolia.
4. Write `derive.ts` and one test: from `(channel_key, token, index, salt)`,
   compute the note id, call `get_note`, unmask, and **assert the amount equals
   what we actually sent**.

Reads confirmed working today:
`https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/demo`,
`get_note` selector
`0x415b4dc014f2ddfa618072aa2ac01257ef9600c971c994ac51d1fb5d842e95`.

**Gate:** if that test is not green by end of Day 2, the fine-grained claims die
and we fall back to a coarser product built on public events plus registry
anchoring. Decide it on Day 2, not Day 9.

## Phase 2, tests beside the logic

`derive`, `claim`, `expose`, `bundle` are pure and get tests as they are written.
All I/O stays in `read.ts` so the decision layer runs with no network. Keep the
existing 14 break-it tests, retargeted at disclosure rules. The one that matters
most: **a bundle whose scope does not cover the claim must fail closed.**

## Phase 3, deterministic, no model in the path

Verification is arithmetic and RPC reads. No LLM anywhere near a verdict. If we
add prose later, it narrates a result the rules already decided.

## Phase 4 and 5, reproducible from the first commit

- `npm run doctor` extends the existing script: hit the RPC, confirm `get_note`
  and `nullifier_exists` exist on the deployed class, confirm the registry
  answers, print the pool address and network in use.
- Committed fixture: one real Sepolia disclosure bundle plus its expected
  verdict, so `npm test` and the demo run offline.
- One-command bring-up, documented as the commands actually run, not remembered.

## Phase 6, verify against reality

Every external assumption gets a live check before code depends on it. Done for
`get_note`. Still to check: the packed-value layout, the mainnet pool address,
and whether Ready exposes what the signing step needs. Anything not run gets
written down as not verified.

## Phase 7, additive and honest

The vault page keeps working while the disclosure routes are built. Guard every
RPC call so a dead endpoint degrades to a clear message instead of a crash.

Delete the abandoned auction code on Day 1: `cairo/src/lib.cairo` is still
Tender, and `/lots`, `/new`, `src/lib/auction.ts`, `src/lib/commitment.ts` belong
to a product we are not shipping. Leaving them makes the repo read as unfocused
to a panel skimming 79 entries.

## Schedule, Aug 18 to Aug 31

| Day | Work | Done when |
| --- | --- | --- |
| 1 | Delete auction code. SDK in. Mainnet pool address found | `doctor` prints both networks |
| 2 | `derive.ts` plus the amount-recovery test on a real note | **gate: test green** |
| 3 | `registry.cairo` anchor, revoke, is_valid. Sepolia deploy | contract tests pass |
| 4 | `bundle.ts` and `/verify` end to end, no wallet | a stranger verifies in a browser |
| 5 | `/request` and `/disclose` with Ready | full loop on Sepolia |
| 6 | **Mainnet cutover.** Deploy registry, first real disclosure | 3 mainnet tx hashes recorded |
| 7 | `expose.ts` pre-check, ported from detect and decide | pre-check screen live |
| 8 | Balance floor and income claims | tests green, running on mainnet |
| 9 | Revocation end to end, `/disclosures` dashboard | a revoked bundle fails to verify |
| 10 | Fixtures, offline path, doctor hardening, bring-up | a clean clone runs |
| 11 | Offer the embed to 2-3 sprint payment projects | one integration, or a written offer |
| 12 | README, docs, `strk20.json`, demo video | all four fields filled |
| 13 | Buffer. Freeze by 18:00 UTC on Aug 31 | final push done early |

## strk20.json, the file the panel actually reads

It currently has four empty fields. It is the deliverable, not an afterthought.
Fill `transactions`, `contracts`, `demo_video`, `demo_url` as each becomes real,
starting Day 6, not on Day 12.

## How this maps to the scoring

- **Integration depth, 30%.** Channel keys, note ids, packed values, nullifiers,
  viewing key derivation, SDK note scanning, and a deployed Cairo contract. The
  old Lens read two public events. This reaches the encrypted layer.
- **Working mainnet product, 30%.** Every disclosure and every revocation is a
  mainnet transaction, so using the product satisfies the requirement instead of
  bolting transactions on afterwards.
- **Innovation, 25%.** Two sprint entries sit in the disclosure space. The
  verifier-issued request and on-chain revocation exist nowhere, on any chain.
- **Docs and open source, 15%.** Already the old project's strongest axis. Keep
  Apache 2.0, keep the honest accounting, keep the tests.

## Revised build plan, 2026-08-19

Supersedes the schedule below. Three things changed it: `docs/PRODUCT.md` found a
second load-bearing assumption, the build process now treats the user journey as
a build requirement rather than polish, and the goal is a product that still
works after 31 August rather than a demo that survives until it.

### The two maps

**Pipeline**, one job per file:

```
derive.ts  keys and locations           pure   DONE
read.ts    public pool reads            I/O    DONE
claim.ts   verified or not, and why     pure   DONE
expose.ts  what this reveals            pure   next
bundle.ts  build, serialise, digest     pure   next
registry   timestamp and revoke         chain  built, undeployed
```

**Journey**, which decides what "working" means from outside the code:

```
verifier asks -> Holder opens -> signs once -> sees the exposure
              -> approves -> anchors -> verifier checks -> can revoke
```

Six answers, one line each:

- **Primary user:** the person who was paid and now has to prove it.
- **Job they came to do:** answer "where did this come from" without over-sharing.
- **Primary action:** approve a scoped disclosure.
- **Minimum we must ask for:** one wallet signature. Nothing else.
- **What we infer instead of asking:** the counterparty's public key, the notes,
  the amounts, the exposure, the whole claim.
- **Where value first appears:** the exposure preview, before anything is shared.

### The new load-bearing assumption, verified first

> A viewing key can be derived deterministically from one wallet signature.

The Wallet API exposes three methods and none of them yield a viewing key, and
the docs forbid asking a user for theirs. Without derivation there is no dapp.
StarkWare's Privacy Bridge does exactly this and persists nothing but the
read-only key. **Reproduce it and check a round trip before building on it.**

### Four states, every flow

Not just the happy path. Each of derive, preview, anchor, verify, revoke needs:

- **Loading**: say what is happening. Proving and RPC reads are slow enough to
  look broken.
- **Success**: what changed, and the next useful action.
- **Empty**: "this lane has no payments" is a real answer, not a bug.
- **Error**: what failed, what is still safe, whether retrying helps. No RPC
  error codes in front of a user.

The verify page's failure states carry unusual weight, because a verifier seeing
a confusing error will assume fraud rather than a network blip. Every failure
reason in `claim.ts` already returns a plain sentence for this reason.

### Chain interactions

One signature at sign-in, one transaction to anchor, one to revoke. Nothing else.
Explain each in product language before requesting it, treat rejection as a
normal outcome, and keep explorer links secondary. The verifier signs nothing and
connects nothing, ever: that is a product rule, not an implementation detail.

### The ninety-second test, asked repeatedly

Can someone who did not build this reach the value without me in the room? The
honest answer today is no, which is why the **contrast panel is built early, not
last**: the old way spills a whole history, the Lens way shows one line. If that
does not land in ten seconds when a stranger looks at it, the weakness is in the
concept and we need to know while there is time.

### Revised schedule, 19 to 31 August

| Day | Work | Done when |
| --- | --- | --- |
| 1 | Reproduce signature-derived viewing key, round trip on sepolia | **gate: our key opens a note we made** |
| 2 | Mainnet: fund, declare, deploy registry, first anchor | 3 mainnet tx, `strk20.json` populated |
| 3 | `bundle.ts` and the verify page, no wallet | a stranger verifies in a browser |
| 4 | Request flow and the exposure preview | full loop, sepolia |
| 5 | Contrast panel, then show it to someone cold | they explain it back correctly |
| 6 | **Halfway checkpoint.** Core loop end to end on mainnet | if not, cut scope now |
| 7 | Revocation end to end, four states everywhere | a revoked bundle fails clearly |
| 8 | Errors, empty states, human messages | no raw RPC text reaches a user |
| 9 | CLI verifier, so proofs outlive the site | verify from a terminal |
| 10 | Reproducibility, fixtures, doctor, one-command bring-up | clean clone runs |
| 11 | README, docs, demo video | submittable |
| 12 | Buffer | freeze 18:00 UTC, 31 Aug |

### Spending order when time runs short

1. The risky assumption. 2. The core loop end to end. 3. The primary journey.
4. Reproducibility. 5. Every integration verified live. 6. Errors and the four
states. 7. Visual polish.

Polish is last. An unusable flow with good typography is wasted work.

### What "done" means here

Works technically, survives failure, is understandable, gives feedback, is
reproducible, can be demonstrated. All six, at once. A passing test is a
component of done, not done.

**Never fake success.** Fixtures and offline paths are legitimate and get labelled
as what they are. A verified badge for something that was not verified is
indistinguishable from fraud from where a judge sits, and it would destroy the
one thing this product sells.

### Real-world, not just sprint-shaped

The instruction is a product that functions after the sprint. Concretely that
means four things get built even though no criterion demands them:

- **No server in the trust path.** Keys derived in memory, bundles passed between
  two people, verification from public reads. If we vanish, proofs still check.
- **A CLI verifier**, so a proof does not depend on our site being up.
- **A documented bundle format**, so another wallet can adopt it. That is the
  only realistic distribution route, since we cannot read keys other wallets hold.
- **The completeness warning on the verifier's own screen.** A disclosure proves
  a payment happened and can never prove another did not. A verifier who thinks
  otherwise has been misled by our interface even when every claim is true.

## Progress

### Day 1, 2026-08-18: gate passed, one day early

The Day 2 gate is green. Risks 1 and 2 below are closed.

- **Packed-value layout resolved from source**, not guessed.
  `packed_value = salt * 2^128 + encAmount`, where
  `encAmount = (h(ENC_AMOUNT_TAG, channel_key, token, index, 0, salt) + amount) mod 2^128`.
  Source: `sdk/src/utils/encryptions.ts` in starkware-libs/starknet-privacy.
  **The salt travels inside the packed value**, so a channel key alone decrypts
  the lane. A verifier needs nothing further from the Holder. This is the
  disclosure primitive, and it is smaller than expected.
- **Confirmed against live chain data.** The real note read on 2026-08-18 splits
  into exactly a 120 bit salt and a 128 bit field, matching the layout.
- **Mainnet pool found and verified live:**
  `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`,
  `get_version` returns `2.0`, `get_note` and `nullifier_exists` both answer an
  anonymous call. It ships as `PRIVACY_POOL_ADDRESS` in `@avnu/avnu-sdk`.
- **`src/core/derive.ts` written and green.** 14 tests, 8 of them asserted
  against the Cairo implementation's own generated vectors
  (`fixtures/cairo-reference-data.json`, copied from the upstream Apache 2.0
  repo). Independent TypeScript checked against Cairo output, not against
  itself.
- **`npm run doctor` rewritten** to check both networks live: pool version,
  `get_note` on an unwritten cell reading zero, `nullifier_exists`, the derive
  vectors, and the offline fixture. All green.
- **Dead code removed:** `/lots`, `/new`, `src/lib/auction.ts`,
  `src/lib/commitment.ts`, `tenderCalldata`, the Tender Cairo contract, and
  `WalletAccountV6Tag.tsx` (599 lines, imported by nothing). Cairo package
  renamed to `lens_registry`.
- **Bug found and fixed in passing:** the default Sepolia RPC was
  `starknet-sepolia.public.blastapi.io`, which now returns "Blast API is no
  longer available" for every method. The mainnet lava default still works.
  Both defaults now point at Cartridge, verified answering `starknet_chainId`
  on both networks.

`npx tsc --noEmit` clean, 32 tests passing.

**Not yet verified:** no note has been decrypted from a channel key we derived
ourselves end to end, because that needs a funded Sepolia account and a real
shielded payment. The arithmetic matches Cairo and the on-chain layout matches
the format, but the full loop is unproven until Day 3. Next up.

## Known risks

1. ~~**Packed-value layout is undocumented.**~~ Closed Day 1, read from SDK
   source and checked against Cairo vectors.
2. ~~**Mainnet pool address not published.**~~ Closed Day 1, found in
   `@avnu/avnu-sdk` and verified live.
3. **SDK needs Node >= 24 and GitHub Packages auth.** Environment friction. If
   the local box fights us, move to a clean container rather than repairing it,
   and commit the container as the deliverable.
4. **Competitors in the lane:** `SodiqAbdulwaris/strk-disclose` and
   `EndPx/zkpayslip`. Both are one-way proof generators. Ship the request and
   revocation halves early, they are the separation.
5. **Solo build, 13 days.** The schedule front-loads mainnet to Day 6 so a bad
   week still leaves a working mainnet product.
