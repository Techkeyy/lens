# Lens

**Show the payment. Not the wallet.**

A selective disclosure layer for STRK20 private payments. Prove one payment
relationship to someone who asks, without handing over your master viewing key
or your entire financial history.

**[Threat model](./THREAT_MODEL.md)** · **[Product model](./docs/PRODUCT.md)** ·
**[What is hidden and what is visible](./docs/HIDDEN-VS-VISIBLE.md)**

STRK20 Private Sprint entry. Apache 2.0.

## The problem

STRK20 makes payments private. Then someone legitimately needs proof.

An exchange asks where a withdrawal came from. A landlord asks for proof of
income. An accountant needs to confirm a contractor was paid.

Today there are two options and both are bad. Say nothing, and lose the account
or the flat. Or hand over your **viewing key**, which is the only sharing
mechanism the protocol has.

## Why a master viewing key is too broad

One key, and the holder sees:

```
Your wallet
├── Employer      every salary payment
├── Client A      every invoice
├── Client B      every invoice
├── Friend        every transfer
└── everything you do in future, forever
```

It cannot be scoped to one relationship, it cannot be time limited, and it
cannot be taken back. Proving one payment costs you your whole financial life.

## What this does

Lens discloses **one relationship** instead:

```
Your wallet
├── Employer      ← disclosed
├── Client A      ← not reachable
├── Client B      ← not reachable
└── Friend        ← not reachable
```

The Verifier checks it against Starknet themselves, with no wallet and no
account, and the Holder can withdraw authorization later.

## Demo

Not yet deployed. `strk20.json` is empty rather than filled with placeholders,
and is populated with real hashes as each piece lands. See
[Mainnet evidence](#mainnet-evidence).

## User workflow

```
Request  →  Connect  →  Discover  →  Preview  →  Approve  →  Verify  →  Revoke
```

1. **Request.** The Verifier says what they need. No wallet, no account.
   They get a link and send it however they already talk to the Holder.
2. **Connect.** The Holder opens it and signs once. That signature derives their
   viewing key in memory. Nothing is stored.
3. **Discover.** Lens finds the relationship with that Counterparty, in both
   directions, and reads the payments locally.
4. **Preview.** The Holder sees exactly what will be revealed, and what will
   not, before agreeing to anything.
5. **Approve.** One transaction records the commitment on Starknet.
6. **Verify.** The Verifier opens the proof and their browser checks it against
   the chain.
7. **Revoke.** The Holder can withdraw authorization at any time.

## Holder, Counterparty, Verifier

Three roles, and collapsing them hides real cases.

| Role | Example | Holds keys |
| --- | --- | --- |
| **Holder** | Alice, who was paid | her own, in memory only |
| **Counterparty** | Alice's employer | not involved at all |
| **Verifier** | Alice's landlord | none, ever |

The employer pays Alice. The landlord asks Alice for proof of that income. The
employer is never contacted, and the landlord never learns about Alice's other
clients.

## What gets revealed

Within the disclosed relationship, for the chosen asset:

- every payment in the included directions
- each amount
- when each was created

## What stays private

- the Holder's master viewing key
- every other counterparty and relationship
- the Holder's balance
- any relationship in a different asset

## STRK20 architecture

| Layer | What Lens uses |
| --- | --- |
| Viewing keys | derived from one wallet signature, never stored or requested |
| Channels | `get_num_of_channels`, `get_channel_info`, ECDH recovery of inbound lanes |
| Identity binding | `channel_exists`, `subchannel_exists` |
| Notes | `get_note`, note id derivation, amount unmasking |
| Registration | `get_public_key` |
| Pool | mainnet `0x0403…812a`, sepolia `0x0254…0d91` |

**Which part would be impossible without STRK20?** All of it. The product is a
narrowing of STRK20's own disclosure mechanism. Without the pool there are no
private payments to disclose; without channel keys there is no unit of scope
smaller than the whole account; and without `channel_exists` a disclosure could
not prove whose payments it shows, only that some notes exist somewhere.

## Directional channel model

A relationship is not one thing. It is two one-way lanes with unrelated keys.

```
outbound   Holder → Counterparty    key derived by the Holder
inbound    Counterparty → Holder    key recovered by ECDH from the record
                                    the Counterparty published
```

The Holder cannot derive the inbound key, because it was built from the
Counterparty's viewing key. They recover it by decrypting the channel record
addressed to them. Lens inspects both, so "payments between you and this
address" is accurate rather than aspirational. A relationship where money only
ever moved one way is normal and handled.

## Disclosure snapshot and commitment

Canonical, versioned, deterministic: `lens-disclosure-v2`.

A disclosure is a **frozen snapshot**, not a live window. It records how many
notes each lane held when the Holder approved, and what they totalled. Notes
live in WriteOnce cells at dense sequential indices, so indices 0..count-1 name
the same notes forever. Verification reads exactly that range.

Two consequences, both intended:

- A payment arriving later is **not** part of the authorized disclosure.
- A payment arriving later does **not** break it either. Under v1 it did, because
  the recomputed total no longer matched.

Later activity is reported as `laterActivityDetected` so an interface can show
it as later activity rather than as approved history. A Verifier holding the
reusable key can read it independently; we surface that rather than hide it.

The commitment covers scheme, chain, pool, request commitment, holder,
counterparty, asset, directions in canonical order, the channel keys, the
snapshot count and total per lane, the aggregate total and the creation time.
Field order is fixed and felts are normalised, so two clients that formatted
differently still agree. An unknown scheme is **refused**, not guessed at.

## Sharing a disclosure

```
https://host/proof/<commitment>#<disclosure>
                   ^^^^^^^^^^^^ public, safe in a request
                                ^^^^^^^^^^^^ never leaves the browser
```

The path carries only the commitment, which is already on chain. The channel
keys live in the fragment, which browsers do not transmit, so they never reach a
server, a log or an analytics call. A file export is available for anyone who
would rather keep the secret out of a URL entirely.

**A disclosure is a bearer credential.** Anyone who obtains the link or file can
read it. There is no recipient authentication, and a fragment persists in
browser history. "Shared with one person" is intent, not a guarantee.

## On-chain registry

Cairo contract, [`cairo/src/lib.cairo`](./cairo/src/lib.cairo). It stores:

```
commitment  →  { holder, created_at, expires_at, revoked_at }
status      →  UNKNOWN | ACTIVE | REVOKED | EXPIRED
```

Deliberately **not** stored: the counterparty, amounts, note contents, keys. The
counterparty is already bound by the commitment, and publishing it would leak
the shape of a Holder's relationships to anyone reading the registry, which is
the harm this product exists to reduce.

## Verification

The Verifier's browser, with no wallet:

1. reads both public keys from the pool
2. recomputes each channel marker and asks `channel_exists`, so the pool itself
   attests the keys belong to that pair in that direction
3. walks the lane and unmasks every amount
4. recomputes the commitment and compares it to the registry
5. reads the live status

The page separates two things that must never blur: facts **the chain
guarantees**, and figures **the disclosure asserts**.

## Revocation semantics

Read this carefully, because the obvious reading is wrong.

Revocation moves the authorization to `REVOKED`. A Verifier reopening the proof
sees that the Holder withdrew authorization, and when.

Revocation does **not**:

- erase what the Verifier already saw, copied or screenshotted
- stop a retained channel key from decrypting that relationship
- make previously revealed information unknowable

It is **authorization revocation**, not access revocation. Nothing in the UI,
the docs or the contract may say "stops working" or "expires", because those
words would be false.

## Threat model

See [THREAT_MODEL.md](./THREAT_MODEL.md).

## Current limitations

**Relationship scoped, not payment scoped.** The boundary is the whole lane with
one counterparty for one asset. A Verifier asking about June gets everything.
The Holder is told before approving.

**Retained keys keep working.** A channel key is reusable. A Verifier who keeps
it can read that relationship afterwards, including later payments. Treat a
disclosure as permanently sharing that relationship with that person. Fixing
this needs snapshot-style bounded disclosure, which is designed for and not
built.

**Cannot prove absence.** A disclosure proves payments happened, never that
others did not.

**No date filtering.** A note's creation block is independently discoverable,
since `EncNoteCreated` carries the note id as an indexed event key. But the
boundary is a note count, not a time range, so any period named in a request is
context from the requester rather than something the maths enforces.

**Not zero knowledge.** Payments inside the disclosed relationship are revealed
in full. The gain is scope, not secrecy.

**Lens identities are Lens identities.** A viewing key derived here will not open
a history registered through another wallet. The route to wider coverage is
other wallets adopting the format, not Lens reading their keys.

## Mainnet evidence

| Item | Status |
| --- | --- |
| Registry, mainnet | **deployed**, `0x7e14bc65…5fb01`, block 13,815,987 |
| Mainnet declare | `0x6124e178200e715c9c0e6c2c6ed08bf1ea3a46a4b8b11b96e595abe0ff6f12d` |
| Mainnet deploy | `0x4b41314ed39bc6d41b6791e4550c804e40da8e00b26c8cc8a36fa4b17e1d9d6` |
| Registry, sepolia | deployed, full lifecycle exercised |
| STRK20 pool transactions | none yet, blocked on the proving service |

The mainnet class hash was rebuilt from source immediately before declaring and
is byte-identical to the one audited on Sepolia.

`strk20.json` carries only hashes that exist. No placeholders. The hashes in it
are the registry's declare and deploy, which are real mainnet transactions but
are **not** STRK20 pool transactions, and
[docs/MAINNET_EVIDENCE.md](docs/MAINNET_EVIDENCE.md) says so in as many words.

## Contract addresses

| Contract | Network | Address |
| --- | --- | --- |
| STRK20 pool | mainnet | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| STRK20 pool | sepolia | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Lens registry | mainnet | `0x7e14bc65e5f759da2a981843c485a948dc6e15548fe0ba51e3ca805ca75fb01` |
| Lens registry | sepolia | `0x51056eb3f8f9408185c9ee9fbfab94f3a5d47c7369a3a72c8783296d1d1b936` |

## Local development

```bash
npm install
cp .env.example .env.local
npm test
npm run doctor
npm run dev
```

`npm run doctor` checks both pools live, the derivation against Cairo's own
reference vectors, and the offline fixture. For the contract:

```bash
cd cairo && scarb build
```

Requires Node 24 and Scarb 2.18.0. See [cairo/README.md](./cairo/README.md).

## Tests

```bash
npm test
```

98 tests. The ones that matter are adversarial: a lane funded by a third party
and attributed to someone else, an inbound key presented as outbound, a tampered
commitment, an unknown scheme, an empty relationship, and four asserting the
master viewing key never appears in a payload, a link or a commitment.

## Future work

- Bounded snapshot disclosure, so a Verifier receives a proof of history rather
  than a reusable key
- A command line verifier, so proofs outlive this site
- Income over a period as a first class claim
- An embeddable button so other STRK20 apps can offer proof of payment

## License

Apache 2.0. See [LICENSE](./LICENSE).
