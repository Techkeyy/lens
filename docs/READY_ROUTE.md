# The Ready route

What the wallet half of the demo can and cannot do, traced to source rather than
inferred. Nothing here has been executed on mainnet.

Status as of 2026-08-25.

---

# Capability, settled

Probed against the real wallet at `/probe`:

| | |
| --- | --- |
| Wallet | Ready X, id `argentX`, build `5.33.9` |
| Wallet API | `0.10.3`, `0.7.2` |
| Feature | `starknet:walletApi` v1.0.0 |
| Account | `0x04c7082c068f3d78d0637c867041e322a33b03ed70606ad4bd8e5771a13f99c8` |
| Network | SN_MAIN |
| `wallet_strk20Balances` | **SUPPORTED**, answered `NOT_REGISTERED` |
| `wallet_strk20PrepareInvoke` | **SUPPORTED**, answered `INVALID_REQUEST_PAYLOAD` to a deliberately empty action list |

Shield, private transfer and unshield are all action variants of the same two
methods, so all three are supported. No action was executed.

`NOT_REGISTERED` is not a failure. It is the honest state of an account that has
never used the pool, and it is the thing to resolve before anything else.

---

# Registration: settled on chain, not from documents

**The first shield registers the account, in the same transaction, for one pool
fee.** Not inferred. Read off mainnet.

Three `ViewingKeySet` events were found in the last ~9,000 blocks. Taking the
most recent, `0x4f5c129690bf459da7edc625d127ecf4eaad3985df713a986d07424666d9378`
at block 13,853,717:

| | |
| --- | --- |
| Type | INVOKE v3, `SUCCEEDED ACCEPTED_ON_L2` |
| Calls in the transaction | **1** |
| Target | the pool |
| Selector | `apply_actions` |
| Pool events emitted | `ViewingKeySet`, `Deposit`, `EncNoteCreated` |

One call. One `apply_actions`. Registration, deposit and the encrypted note all
came out of it together.

That matches the SDK exactly: `sdk/src/internal/compiler.ts` puts
`SetViewingKey` first in the same `clientActions` list, then the self-channel,
then the deposit, and one list compiles to one `apply_actions`.

**Consequences:**

- No standalone Ready registration step.
- No second 6 STRK fee for registering.
- Ready's first shield *is* the registration event, and is itself a qualifying
  pool transaction.

An earlier version of this document budgeted for a separate registration and
concluded Ready was about 1 STRK short. That conclusion was wrong, and the
redistribution it recommended is not needed.

The same transaction also shows the token flows: two `Approval`/`Transfer` pairs
on STRK inside the call, one for the 6 STRK protocol fee and one for the deposit
itself, both consuming allowance the account had already granted. Live allowance
from both our accounts to the pool currently reads **0**, so an approval has to
happen before the shield. Ready requests it as part of its own flow.

---

# Correction: the dapp Wallet API will not bootstrap registration

The section below reasoned that because the protocol registers inside the first
shield, the correct dapp behaviour was to offer the shield and let registration
happen inside it. **Live behaviour disproves that**, and it was the optimistic
reading of an ambiguous sentence rather than something observed.

Ready X refused `wallet_strk20InvokeTransaction` with a deposit action **three
times**, each with code `118 NOT_REGISTERED`, returning no transaction hash.

Verified afterwards that nothing was spent, on two RPCs: Ready's STRK balance
unchanged at **24.944503** to the last digit, allowance still `0`,
`get_public_key` still `0`, and zero `ViewingKeySet`, `Deposit` or
`EncNoteCreated` events for the account across 40,000 blocks. The wallet refused
before building anything.

So there are two distinct flows, and the spec sentence covers only the first:

| | Registers an unregistered account? |
| --- | --- |
| **Ready's own privacy interface** | yes, this is where a first shield belongs |
| **Dapp Wallet API** (`wallet_strk20InvokeTransaction`) | **no**, answers `NOT_REGISTERED` |

`/ready` now disables every action while the account is unregistered and says
where to go instead. The protocol-level finding underneath is still correct: a
first shield really is one `apply_actions` emitting registration and deposit
together for a single pool fee. Ready will just only do it from its own UI.

---

# There is no dapp-driven registration method



The Wallet API at `0.10.3` defines exactly three STRK20 methods:
`wallet_strk20InvokeTransaction`, `wallet_strk20PrepareInvoke`,
`wallet_strk20Balances`. Confirmed against the installed
`@starknet-io/types-js@0.10.3`, which is the same package the wallet types
against.

**There is no `wallet_strk20Register`.** A dapp cannot register a user, and Lens
must not pretend to. The spec's wording on `wallet_strk20InvokeTransaction` is:

> Registration into the pool is transparent — if the user is not registered,
> `NOT_REGISTERED` is returned.

Read together with the on-chain evidence above, "transparent" means what it
says: the wallet registers the user as part of the first shield, without the
dapp asking and without a method for the dapp to ask with. `NOT_REGISTERED` is
what the *read* methods return until that has happened.

So the correct dapp behaviour is not to send the user elsewhere to register. It
is to offer the shield, and let registration happen inside it. `/ready`
implements exactly that: the shield button is enabled while unregistered and
labelled as the thing that registers the account, and there is no register
button, because there is no register method.

---

# Two places the published guidance does not match the deployed contract

Both matter, and both are recorded here because following the guide as written
would fail.

## 1. "Registration and shielding need no proof" is not true of this pool — resolved

`MAINNET-DAY-0.md` states:

> **What needs no proof at all:** registering a viewing key, and shielding. Both
> are ordinary public transactions. A headless service can move value *into* the
> pool today with nothing but an RPC URL.

The deployed contract disagrees. Every user-facing write goes through
`apply_actions`, and its first act is:

```cairo
fn validate_proof(self: @ContractState, actions: Span<ServerAction>) {
    ...
    assert(!proof_facts_span.is_empty(), errors::EMPTY_PROOF_FACTS);
```

There is no exemption for `SetViewingKey` and none for `Deposit`. The full entry
point list of the live mainnet class was enumerated to be sure: 45 functions, of
which the only non-admin externals are `__execute__`, `compile_and_panic` and
`apply_actions`. There is no separate registration or deposit entry point.

Confirmed live as well: calling `apply_actions` read-only with an empty action
list and `screening: None` reverts with `EMPTY_PROOF_FACTS`, not with a
screening or argument error.

**Resolved by the same mainnet transaction.** `0x4f5c1296…` registered and
shielded through `apply_actions` and succeeded. `validate_proof` runs first in
that function and asserts the proof facts are non-empty, so a transaction that
succeeded must have carried them. Registration on this pool needs a proof.

The RPC transaction object does not expose a `proof_facts` field, which is why
this had to be established by inference from the contract rather than read
directly: the field is consumed from `tx_info` at execution, not serialised back
by `starknet_getTransactionByHash`.

Of the four candidate explanations, **C is the answer**: Ready's wallet route
supplies the proof facts transparently. The user never runs a prover; the wallet
does. The Day-0 sentence is true from a *user's* point of view and false as a
statement about the protocol, and reading it as the latter is what sent us
looking for a registration path that does not exist.

**Implication for Lens, and it is the important one:** Lens registration is
*not* exempt. It still needs a prover, and Lens has no wallet to do the proving
on its behalf, because the whole point is that Lens registers a key it derives
itself. Nothing here unblocks step 3. Lens registration must not be attempted on
the assumption that it is proof-free.

## 2. The published viewing-key derivation is missing the canonical fold

The guide gives:

```ts
const messageHash = hash.starknetKeccak(`${chainId}:${poolAddress}`);
const { r, s } = await account.signMessage(/* ... */);
const folded = BigInt(hash.computePoseidonHashOnElements([r, s]));
const reduced = folded % ec.starkCurve.CURVE.n;
```

The contract requires more than that (`privacy.cairo:260`):

```cairo
assert(is_canonical_key(key: user_private_key), errors::PRIVATE_KEY_NOT_CANONICAL);
```

with `is_canonical_key(key) = key < HALF_ORDER`. A key reduced only modulo the
curve order lands above `ORDER / 2` about half the time, and that transaction
reverts with `PRIVATE_KEY_NOT_CANONICAL`.

Lens already folds into the canonical half in `foldToViewingKey`, so Lens's
derivation is correct and the published snippet is incomplete. Worth reporting
upstream: anyone following that snippet gets an intermittent revert that looks
random.

**A consequence worth testing later, at zero cost.** The guide calls that
derivation canonical, and it is the same construction Lens uses. If Ready also
derives its viewing key that way, then the key Lens derives from a Ready
signature would equal the key Ready registered. That is checkable with two
reads once Ready is registered: compare `get_public_key(READY)` against
`publicViewingKey` of the key Lens derives from a Ready signature. If they
match, Lens can read a wallet-registered relationship directly, which is a much
stronger product than the current design assumes. If they differ, nothing is
lost and the existing plan stands. **Untested. Do not build on it.**

---

# Revised sequence

Each step, with what it actually costs and who must approve it.

| # | Step | Submitted by | Pool tx | 6 STRK fee | Screening | Ready confirm | Lens prover | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | Approve pool for fee + deposit | Ready | no | no | no | yes | no | no |
| 1 | **First shield, which registers** | Ready, `wallet_strk20InvokeTransaction` | **yes** | **yes** | **yes** | yes | no | **tx 1** |
| 2 | Register Lens | Lens account, SDK route | **yes** | **yes** | no | no | **yes** | tx 4 |
| 3 | Private transfer A to Lens | Ready, `wallet_strk20InvokeTransaction` | **yes** | **yes** | no | yes | no | **tx 2** |
| 4 | Private transfer B to Lens | Ready, `wallet_strk20InvokeTransaction` | **yes** | **yes** | no | yes | no | **tx 3** |
| 5 | Lens authorize | Lens account, Lens registry | no | no | no | no | no | no |
| 6 | Lens revoke | Lens account, Lens registry | no | no | no | no | no | no |

Step 2 must come before step 3: a private transfer needs the recipient's public
viewing key to exist, so Lens has to be registered before Ready can pay it.

Steps 1, 3 and 4 need no prover of ours and are the **three qualifying hashes**
on their own, so the evidence requirement no longer depends on a judge counting
registration as substantive payment activity. **Step 2 remains the only step
blocked**, and it is now a fourth transaction rather than one of the minimum
three.

---

# Budget, with measured gas

Earlier versions of this budget estimated gas at "≤1.0 STRK" per pool
operation. **That was wrong, and it is the finding that matters here.**

Gas was measured off eight real, successful mainnet pool transactions in the
last ~9,000 blocks, reading `actual_fee` from their receipts:

| Gas paid, STRK | Shape |
| --- | --- |
| 2.745 | NoteUsed + Withdrawal |
| 2.753 | NoteUsed + Withdrawal |
| 2.755 | NoteUsed + Withdrawal |
| 2.769 | NoteUsed + Withdrawal |
| **2.781** | **NoteUsed + EncNoteCreated**, a pure private transfer |
| 2.946 | NoteUsed + EncNoteCreated + Withdrawal |
| 3.016 | NoteUsed + EncNoteCreated + Withdrawal |
| 3.046 | NoteUsed + EncNoteCreated + Withdrawal |

Mean 2.85, max 3.05. The first-shield transaction examined earlier paid
**2.91**. These are proof-carrying transactions, so the calldata is large and
the gas is nothing like an ordinary transfer.

**A pool operation therefore costs about 6 + 2.9 = 8.9 STRK, not 6.**

| | Lens `0x4736...1aca` | Ready `0x04c7...99c8` |
| --- | --- | --- |
| Balance, live | 17.8488 | 24.9445 |
| Pool operations | 1 | 3 |
| Fees | 6 | 18 |
| Gas at 2.9 | 2.9 | 8.7 |
| Deposit | none | D |
| Registry writes | ≈0.2 | none |
| **Needed** | **≈9.1** | **≈26.7 + D** |
| **Remaining** | **≈8.7** | **≈-1.8 - D** |

**Ready cannot afford three pool operations**, and that is true even with a
zero deposit. The shortfall is about 1.8 STRK before anything is shielded.

Across both accounts there is enough: 42.79 STRK held against roughly 38.8
needed. Only the distribution is wrong.

## Two ways out

**Option A: move STRK from Lens to Ready.** Keeps all three payment-side
transactions, which is the stronger evidence set because it does not depend on
a judge counting registration as payment activity.

Moving 8 STRK leaves Ready ≈32.9 against ≈29.7 needed with a 3 STRK deposit,
and Lens ≈9.85 against ≈9.1. Both margins are thin, roughly 3 STRK and 0.75
STRK, and gas moves.

**Option B: two Ready operations, and let Lens registration be the third
hash.** Shield, one private transfer, and the Lens registration are three
qualifying pool transactions on their own.

| | Needed | Held | Margin |
| --- | --- | --- | --- |
| Ready, 2 ops + 3 STRK deposit | ≈20.8 | 24.94 | ≈4.1 |
| Lens, 1 op + registry | ≈9.1 | 17.85 | ≈8.7 |

**No redistribution, no top-up, and comfortable margins on both sides.** The
cost is that the second private transfer becomes optional, which also means
losing the later-activity demo unless the budget allows it after the fact.

## Recommendation

Neither, yet. **Do the shield first and measure it**, because it is the one
transaction whose real cost we can learn without committing to a plan. It is
also transaction 1 under either option.

After it lands, the receipt gives exact gas for our own account and the
decision becomes arithmetic instead of an estimate. If the measured cost is at
the low end, Option A fits without moving anything.

Chosen demo amounts, unchanged and still affordable under both options:

| | |
| --- | --- |
| Deposit | 3 STRK |
| Private transfer A | 1 STRK |
| Private transfer B | 1 STRK, budget permitting |
| Left shielded | 1 STRK, so the snapshot boundary is visible |

# Open questions

1. ~~Does Ready bundle `SetViewingKey` into the first transaction?~~ **Settled:
   yes**, verified on chain.
2. ~~Does registration need no proof?~~ **Settled: it needs one.** The wallet
   supplies it. Lens has no wallet to do that for it.
3. **Arbitrary recipient at runtime.** API-level support is settled. Runtime
   stays **UNVERIFIED** until a real Ready to Lens transfer succeeds.
4. **Does Lens derive the same viewing key Ready registered?** Untested, and
   nothing is built on it. Testable read-only once Ready is registered: compare
   `get_public_key(READY)` against the public half of the key Lens derives from
   a Ready signature. Public keys only; the private half is never displayed or
   logged.
