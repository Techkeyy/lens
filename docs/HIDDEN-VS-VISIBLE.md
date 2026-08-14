# Hidden vs visible

Judges should be able to score this without trusting marketing copy. This is the accounting.

## Pool rules Tender inherits

Inside the STRK20 pool, sender, recipient, token, amount, and spent notes are private. Deposits and withdrawals are public ERC-20 legs. Timing is public. Open-note amounts are plaintext because they are measured at execution time.

Tender does not claim otherwise.

## Uniform deposits

A sealed bid that withdraws the true amount to the helper would leak the amount (pool → helper is a public transfer). So every bid withdraws exactly `max_bid`. The real number is `poseidon(TENDER_BID_COMMIT:V1, amount, salt)` stored on the helper.

Observers learn *that* a bid was placed, not *what* it was.

## Per action

### Shield (vault)

| Hidden | Visible |
| --- | --- |
| Later use of the notes | Depositor address, token, amount |

### Private transfer (vault)

| Hidden | Visible |
| --- | --- |
| Sender, recipient, token, amount, notes | That the pool was used, and when |

### Unshield (vault)

| Hidden | Visible |
| --- | --- |
| Which notes funded it | Recipient, token, amount |

### List

The seller withdraws the lot to the helper through the pool. `privacy_invoke` records parameters and keeps the tokens reserved.

| Hidden | Visible |
| --- | --- |
| Who listed | Lot token, lot size, bid token, max/min, clocks, kind |
| Seller’s other balances | A pool → helper transfer of the lot amount |

### Bid

| Hidden | Visible |
| --- | --- |
| Who bid | A new bid id and a commitment hash |
| The actual bid | A pool → helper transfer of exactly `max_bid` |
| Which notes paid | Bid count on the lot |

### Reveal

Reveal also goes through `privacy_invoke`, so the caller the chain sees is the pool, not the bidder. Calldata of the helper includes the opened amount.

| Hidden | Visible |
| --- | --- |
| Who revealed | Bid id and amount |

The salt stays in the bidder’s browser until this moment. Export it from `/protocol` if you will reveal on another machine.

### Settle

Anyone may call `settle` after `reveal_end`. It walks at most 32 bids, picks the highest revealed amount ≥ reserve, and sets the price.

- Vickrey: second-highest revealed bid, or the reserve if only one valid bid
- First price: the winning bid itself
- No valid reveal: unsold; seller reclaims the lot

| Hidden | Visible |
| --- | --- |
| Identities | Winner bid id, clearing price, bid count |

### Claims

Lot, proceeds, refund (`max_bid − price` for the winner, `max_bid` for losers), and unsold lot all return via `OpenNoteDeposit`. The helper approves the pool; the pool pulls.

| Hidden | Visible |
| --- | --- |
| Who claimed | Token and amount credited to an open note |
| Where the note sits next | That a claim of that type ran |

## What Tender is not

- Not a mixer. Deposits and the helper’s public legs remain linkable by amount and time if you are careless.
- Not sub-account based. The Wallet API route for sub-accounts is not shipping; we did not fake it.
- Not a viewing-key wallet. Ready holds the key.
- Not commit-reveal without money. The max bid is locked before you can hold a place.

## Commitment

Cairo and TypeScript must agree:

```
poseidon([ 'TENDER_BID_COMMIT:V1', amount, salt ])
```
