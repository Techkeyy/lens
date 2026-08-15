# Hidden vs visible

Judges should be able to score this without trusting marketing copy. This is the accounting from the official STRK20 docs.

## Pool rules Lens inherits

Inside the STRK20 pool, sender, recipient, token, amount, and spent notes are private. Deposits and withdrawals are public ERC-20 legs. Timing is public. Open-note amounts are plaintext because they are measured at execution time.

Lens does not claim otherwise.

## Per action

### Shield

| Hidden | Visible |
| --- | --- |
| Later use of the notes | Depositor address, token, amount |

### Private transfer

| Hidden | Visible |
| --- | --- |
| Sender, recipient, token, amount, notes | That the pool was used, and when |

### Unshield

| Hidden | Visible |
| --- | --- |
| Which notes funded it | Recipient, token, amount |

## Look-back

Look-back reads the pool’s `Deposit` event (first indexed key = `user_addr`) and `Withdrawal` event (first indexed key = `to_addr`). It does not attribute activity to the transaction sender. The sender on a private transaction is a relayer.

## Look-ahead

Look-ahead grades a planned shield, send, or unshield against those public edges before the wallet signs. Matching a recent deposit with the same unshield amount is **loud**. A private send next to a public door is **noisy**. A lone in-pool transfer is **quiet**.

## Quieter path

Rewrites are wait, split, different amount, or transfer first. They change the planned action. The user still confirms in Ready.

## What Lens is not

- Not a mixer. Deposits and withdrawals remain linkable by amount and time if you are careless.
- Not sub-account based. The Wallet API route for sub-accounts is not shipping; we did not fake it.
- Not a viewing-key wallet. Ready holds the key.
- Not a claim that helper-leg amounts are private. They are not.
