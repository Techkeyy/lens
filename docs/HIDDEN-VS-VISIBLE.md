# Hidden vs visible

Judges should be able to score this without trusting marketing copy. This is the accounting from the official STRK20 docs.

## Pool rules Lens inherits

Inside the STRK20 pool, sender, recipient, token, amount, and spent notes are private. Deposits and withdrawals are public ERC-20 legs. Timing is public. Open-note amounts are plaintext because they are measured at execution time.

Lens does not claim otherwise. It does not invent a global anonymity-set size.

## Per action

### Shield: grade never `quiet`

| Hidden | Visible |
| --- | --- |
| Later use of the notes | Depositor address, token, amount |

### Private transfer: only this can be `quiet`

| Hidden | Visible |
| --- | --- |
| Sender, recipient, token, amount, notes | That the pool was used, and when |

### Unshield: grade never `quiet`

| Hidden | Visible |
| --- | --- |
| Which notes funded it | Recipient, token, amount |

## Look-back

Look-back reads the pool’s `Deposit` event (first indexed key = `user_addr`) and `Withdrawal` event (first indexed key = `to_addr`). It does not attribute activity to the transaction sender. The sender on a private transaction is a relayer.

Live scan covers the last 80,000 blocks on the configured RPC. Older edges are not claimed.

## Look-ahead

Look-ahead grades a planned shield, send, or unshield against those public edges before the wallet signs.

- Matching a recent deposit with the same unshield amount is **loud**.
- A private send next to a public door is **noisy**.
- A lone in-pool transfer is **quiet**.
- A shield or unshield with no extra pattern is still **noisy**. The door is public.

## Quieter path

Rewrites are wait, split, different amount, or transfer first. They change the planned action. The user still confirms in Ready. There is no rewrite that makes a shield private.

## What Lens is not

- Not a mixer. Deposits and withdrawals remain linkable by amount and time if you are careless.
- Not sub-account based. The Wallet API route for sub-accounts is not shipping; we did not fake it.
- Not a viewing-key wallet. Ready holds the key.
- Not a claim that helper-leg amounts are private. They are not.
- Not RFP-08. Sealed-bid auctions are a different product (`tinoxbt/sealed`).
