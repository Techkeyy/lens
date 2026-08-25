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

# There is no dapp-driven registration

The Wallet API at `0.10.3` defines exactly three STRK20 methods:
`wallet_strk20InvokeTransaction`, `wallet_strk20PrepareInvoke`,
`wallet_strk20Balances`. Confirmed against the installed
`@starknet-io/types-js@0.10.3`, which is the same package the wallet types
against.

**There is no `wallet_strk20Register`.** A dapp cannot register a user, and Lens
must not pretend to. The spec's wording on `wallet_strk20InvokeTransaction` is:

> Registration into the pool is transparent — if the user is not registered,
> `NOT_REGISTERED` is returned.

Those two halves pull in different directions, and the honest reading is that
registration is the wallet's business and the dapp's only correct response to
`NOT_REGISTERED` is to send the user somewhere that can register them.

On the SDK route the mechanics are visible and unambiguous.
`sdk/src/internal/compiler.ts` builds one `clientActions` list, and when
`autoRegister` is set and the user has no public key it puts `SetViewingKey`
first in **that same list**, followed by the self-channel and then the deposit.
One list compiles to one `apply_actions`, so on that route registration is
bundled into the first transaction and costs no extra pool fee.

Whether Ready mirrors that internally is **not provable from the spec**, and
guessing would be exactly the kind of assumption that has already cost us two
probe rewrites. It is listed below as the one open mechanical question.

The documented way to resolve it costs nothing to plan for: the sprint's own
`MAINNET-DAY-0.md` points at `strk20.starknet.io/app`, "which does registration
and shielding through the UI". Registering the Ready account there once removes
the ambiguity entirely.

---

# Two places the published guidance does not match the deployed contract

Both matter, and both are recorded here because following the guide as written
would fail.

## 1. "Registration and shielding need no proof" is not true of this pool

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

If the guidance is right, there is a mechanism not visible in the ABI or the
RC.2 source, and finding it would unblock this project completely. That makes it
worth asking about rather than dismissing. If the guidance is simply stale, then
registration needs a prover like everything else, and the plan already accounts
for that.

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

| # | Step | Submitted by | Pool tx | 6 STRK fee | Screening | Ready confirm | Lens prover | Qualifies as evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0a | Approve pool for STRK fee | Ready | no | no | no | yes | no | no |
| 0b | Approve pool for the deposit amount | Ready | no | no | no | yes | no | no |
| 1 | Register Ready | Ready, via its own UI or `strk20.starknet.io/app` | **yes** | **yes**, unless bundled into step 2 | no | yes | no | **yes** |
| 2 | Shield / deposit | Ready, `wallet_strk20InvokeTransaction` | **yes** | **yes** | **yes** | yes | no | **yes** |
| 3 | Register Lens | Lens account, SDK route | **yes** | **yes** | no | no | **yes** | **yes** |
| 4 | Private transfer A to Lens | Ready, `wallet_strk20InvokeTransaction` | **yes** | **yes** | no | yes | no | **yes** |
| 5 | Private transfer B to Lens | Ready, `wallet_strk20InvokeTransaction` | **yes** | **yes** | no | yes | no | **yes** |
| 6 | Lens authorize | Lens account, Lens registry | no | no | no | no | no | no |
| 7 | Lens revoke | Lens account, Lens registry | no | no | no | no | no | no |

Step 3 must come before step 4: a private transfer needs the recipient's public
viewing key to exist, so Lens has to be registered before Ready can pay it.

Steps 1, 2, 4 and 5 need no prover of ours. **Step 3 remains the only one that
does**, and it is still blocked.

If Ready bundles registration into step 2 the way the SDK does, step 1
disappears and one 6 STRK fee comes back. Planning assumes it does not, because
the cheaper assumption is the one that breaks a budget.

---

# Budget

Pool fee is `get_fee_amount()`, read live: **6 STRK per `apply_actions`,
unconditional**. Gas is an estimate, based on the 0.037 STRK registry deploy
invoke and rounded generously upward for the much larger proof-carrying calldata.

| | Lens `0x4736...1aca` | Ready `0x04c7...99c8` |
| --- | --- | --- |
| Balance | 17.85 STRK | 24.94 STRK |
| Pool operations | 1 (register) | 3, or 4 if registration is separate |
| Pool fees | 6 | 18, or 24 |
| Gas estimate | ≤0.7 (register + authorize + revoke) | ≤2.0 (incl. two approvals) |
| Deposit amount | none | see below |
| **Left** | **≈11.1** | **≈4.9, or ≈-1.1** |

**This is the finding that changes the plan.** If Ready needs its own
registration transaction, Ready is **short by roughly 1 STRK before any deposit
at all**, and there is no demo left to fund.

The fix does not need external money. Lens has about 11 STRK of headroom against
a 6 STRK commitment.

**Recommended: move 8 STRK from Lens to Ready before anything else.** That
leaves Lens ≈9.85 against ≈6.7 of spend, and Ready ≈32.9 against ≈26 of fees and
gas, which leaves 6 to 7 STRK for the deposit under the pessimistic assumption
and comfortably more if registration turns out to be bundled.

Recommended demo amounts, under the pessimistic assumption:

| | |
| --- | --- |
| Deposit | 4 STRK |
| Private transfer A | 1.5 STRK |
| Private transfer B | 1.5 STRK |
| Left shielded in Ready | 1 STRK |

Round numbers, readable in a demo, and small enough that nothing meaningful is
at risk.

**External top-up required: no.** The two accounts hold 42.79 STRK between them
against roughly 33 STRK of worst-case fees, gas and deposit. Only the
distribution is wrong, and moving STRK between two accounts we control is a
transfer, which is the account holder's to run, not this agent's.

---

# Open questions

1. **Does Ready bundle `SetViewingKey` into the first STRK20 transaction?** The
   SDK does. The spec says registration is "transparent" and also that
   `NOT_REGISTERED` is returned. Resolvable for free by registering the Ready
   account once through `strk20.starknet.io/app` and re-running `/probe`: if
   `wallet_strk20Balances` stops answering `NOT_REGISTERED`, registration
   happened and the count of pool operations is known exactly.
2. **Does registration really need no proof?** See above. If the guidance is
   right, the Lens blocker disappears entirely.
3. **Arbitrary recipient at runtime.** API-level support is settled. Runtime
   stays **UNVERIFIED** until a real Ready to Lens transfer succeeds.
