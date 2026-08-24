# Lens: what we are building

Product understanding, written before the interface exists. The rule that governs
it: if it cannot be explained simply, it is not understood well enough to build.

## The one sentence

> **Lens** helps **someone who was paid privately on Starknet** **prove a single
> payment to one person who asked for it**, by **handing over a key that opens one
> counterparty relationship and nothing else**.

## The problem, as a story

Ada does contract work and gets paid in USDC through Starknet's privacy pool. In
March she moves 8,000 USDC out to an exchange. The exchange freezes it and asks
where it came from.

She has two options. Say nothing, and lose the account. Or hand over her viewing
key, which shows the exchange every payment she has ever received, every client
she has ever had, everything she has ever paid, and everything she will do in
future, permanently. There is no third option and no way to take it back.

She is being asked to prove one electricity bill and the only key on the ring
opens the whole house.

## Before and after

| | Today | With Lens |
| --- | --- | --- |
| Prove one payment | impossible without the master key | one scoped key |
| What the other side learns | your entire financial history, forever | one relationship |
| Who has to trust whom | they trust your screenshot | neither, they check the chain |
| Take it back | no | one transaction |

## The three roles

The Counterparty and the Verifier are usually different people. Alice's employer
pays her privately; her landlord asks her to prove that income. Alice is the
Holder, the employer is the Counterparty, the landlord is the Verifier, and the
employer is never contacted.

| Actor | Wants | Talks to Lens directly |
| --- | --- | --- |
| **Holder** (Ada) | to prove one payment without over-sharing | yes, primary user |
| **Verifier** (landlord, exchange, accountant) | proof they can check themselves | yes, no wallet needed |
| Starknet wallet | signs once, so keys can be derived | via the browser |
| **Counterparty** (the employer) | nothing. Not a participant | no, never contacted |
| STRK20 pool | holds the notes, answers public reads | read-only |
| Disclosure registry | timestamps and revokes | one write per disclosure |

## The journey, both sides

| Step | What the user does | What the system does |
| --- | --- | --- |
| 1 | Verifier describes what they need, no wallet | Builds a scoped request, returns a link |
| 2 | Sends the link however they already talk | Nothing. The link is the message |
| 3 | Holder opens it, connects a wallet | Asks for one signature, derives the viewing key in memory |
| 4 | Reads what this will expose | Derives the channel key, scans the lane, computes the exposure |
| 5 | Approves | Builds the bundle, anchors its digest on mainnet |
| 6 | Sends the bundle back | Nothing. Out of band by design |
| 7 | Verifier opens it | Binds the key to the pair, reads the notes, checks the anchor |
| 8 | Holder revokes later | One transaction. Status becomes REVOKED for anyone checking |

Two things are deliberate. The verifier never connects a wallet, and the bundle
never touches a server we run.

## The magic moment

**Step 4.** Ada sees, in plain words, before agreeing to anything:

> This reveals your 6 payments with Acme, in both directions. It does not reveal
> your balance, your other clients, or your viewing key.

That is the moment a third option exists where there were only two. Everything
else in the build serves that sentence being true and legible.

What must work for it: signature to viewing key, viewing key to channel key,
channel key to notes, and honest exposure accounting. Four things. That is the
critical path, and it is shorter than the feature list.

## The core loop

```
Request -> Derive -> Preview -> Anchor -> Verify -> (Revoke)
```

## The boxes

| Box | Job | Technology |
| --- | --- | --- |
| Request builder | capture what the verifier needs | pure TypeScript, no wallet |
| Key derivation | one signature to a viewing key to channel keys | `derive.ts`, Poseidon |
| Reader | pull notes and bindings from the pool | `read.ts`, public RPC reads |
| Claim engine | decide verified or not, and why | `claim.ts`, deterministic |
| Exposure engine | what this reveals beyond the question | `expose.ts`, from old Lens |
| Anchor | timestamp, issuer, revocation | `lens_registry` Cairo contract |
| Verifier page | check it, no wallet, no account | browser, reads chain directly |

## Data, and where it lives

| Data | Where | Why |
| --- | --- | --- |
| Viewing key | memory only, derived per session | never stored, never asked for, never sent |
| Channel key | inside the bundle, given to one person | it is the disclosure |
| Notes and amounts | already on chain, encrypted | we only decrypt what the scope covers |
| Bundle | passed between two people, off chain | publishing it would defeat the point |
| Bundle digest | on chain | timestamp and revocation need a public record |
| Requester identity | **not** on chain | already committed to by the digest; publishing who asked leaks a relationship |

## The technology necessity test

| Piece | What breaks without it | Verdict |
| --- | --- | --- |
| STRK20 pool | there is no product | load-bearing |
| `channel_exists` binding | anyone can pass off someone else's lane as their own | load-bearing |
| Signature-derived viewing key | no way to get keys without asking for them, which the docs forbid | load-bearing |
| Registry contract | proofs still verify, but no timestamp and no revocation | load-bearing to the promise, not to the maths |
| Privacy SDK | needed to make payments, not to verify them | important, not load-bearing |
| Next.js | a different frontend would do | convenience |
| LLM | nothing. There is none | absent, deliberately |

No model is involved anywhere. Verification is arithmetic and public reads, and a
verdict that depended on a model's mood would be worth nothing.

## Trust, stated honestly

**The verifier must trust:** Starknet's state, the Poseidon hash, and that the
page computing the check is honest. That last one is why the verifier is open
source and why a command line verifier ships alongside it.

**The verifier does not have to trust:** us, the Holder, or any server. Every
input to the verdict is a public read.

**Who can cheat, and how:** the Holder chooses *which* lane to reveal. So a
disclosure proves that a payment happened. **It can never prove that another
payment did not.** Someone can truthfully prove Acme paid them 8,000 while
saying nothing about a second client who paid more.

That matters most for the source-of-funds use case, and we will say it on the
verifier's own screen rather than in a footnote. A verifier who thinks they are
seeing a complete picture is being misled by our interface, even if every
individual claim is true.

**If Lens disappears:** the bundle format is documented and the data is on chain,
so proofs stay checkable with the CLI or by hand. The product is a convenience
over a public record, not a custodian of one.

**Revocation withdraws authorization. It cannot un-see.** If they screenshotted it,
that is gone, and the button says so.

## The load-bearing assumption

The first one is verified. A stranger can read a note from a channel key with no
key of their own: `get_note` answered an anonymous call on mainnet, matching the
event exactly.

The second one is the product-shaping one, and it was nearly missed:

> **A user's viewing key can be derived deterministically from one wallet
> signature, so Lens never holds a key and never asks for one.**

This matters because the Wallet API exposes exactly three methods, none of which
give a dapp the viewing key, and the docs say plainly: *do not ask a normal dapp
user for their viewing key.* Without derivation, a Lens dapp cannot compute a
channel key at all.

**Status: the pattern is confirmed, our implementation is not.** StarkWare's own
Privacy Bridge derives it from a single signature and persists nothing but the
read-only key, mirroring the reference demo. We have read that code. We have not
yet reproduced it and checked that the derived key matches a registration Lens
itself made. That check comes before anything is built on top.

**The consequence, stated up front:** a Lens-derived key is a *Lens* identity. It
will not open a history that Ready registered. So version one serves people who
register through Lens, and the honest long-term route is other wallets adopting
the disclosure format, not Lens reading their keys.

## The smallest real MVP

**Must have**, because the magic moment dies without it:

1. Sign in, derive keys, never store them
2. Scoped request link, built without a wallet
3. Exposure preview in plain language
4. Anchor on mainnet
5. Verifier page that checks against chain with no wallet
6. Revoke

**Useful next:** income over a period, embeddable button for other apps, CLI
verifier, request templates for common asks.

**Future:** ZK-backed per-note scoping, proof of non-association, wallet
adoption of the format.

## Non-goals

- **Not a wallet.** We derive a key to read and prove. Payments happen elsewhere.
- **Not a mixer.** Deposits and withdrawals stay public. Lens makes them
  explainable, not invisible.
- **Not proof of absence.** Cannot and will not claim completeness.
- **Not per-note granularity in v1.** A channel key opens a lane. Anything finer
  needs a circuit, and we say so instead of implying otherwise.
- **Not retrofitting other wallets' histories.** Stated as a limitation, not
  hidden as a bug.

## Life after the sprint

The reason this is worth building past 31 August: every privacy system eventually
collides with someone asking "where did this come from," and the answer today is
all or nothing. That is not a hackathon problem, it is the reason ordinary people
do not use privacy tools. Monero and Zcash both grew a version of this because
users demanded it.

The realistic first users are not exchanges, who move slowly. They are
freelancers proving payment to a client, teams proving a disbursement to their
community, and anyone who has to explain a withdrawal to an accountant. That is a
small, real audience reachable without institutional adoption, and it is who
version one is for.

## Three explanations

**To a child:** you can show someone one page of your diary without giving them
the whole diary, and you can ask for the page back.

**To an adult:** private payments on Starknet are invisible to everyone, which is
good until someone legitimately needs proof. Today the only way to share is a
master key that reveals your entire financial history forever. Lens gives you a
key that opens one relationship, that the other person can check against the
public record without an account, and that you can switch off.

**To a developer:** a viewing key is derived from one wallet signature and held in
memory. From it we derive `channel_key`, then `note_id` per index, and read the
pool's public `get_note` until the first empty slot, unmasking amounts with the
salt carried in the packed value. Identity is bound by recomputing
`channel_marker` and calling the pool's public `channel_exists`, which makes the
pool itself attest that the key belongs to that pair. The bundle stays off chain;
its digest is anchored in a Cairo registry that records issuer and timestamp and
supports issuer-only revocation. Verification is public reads only, so it runs in
any browser with no wallet.
