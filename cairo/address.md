# Tender helper

No constructor arguments. First successful `privacy_invoke` from the STRK20 pool pins the pool address.

```
class hash: set after declare
mainnet:    set after deploy  (also NEXT_PUBLIC_TENDER_HELPER_MAINNET)
sepolia:    set after deploy  (also NEXT_PUBLIC_TENDER_HELPER_SEPOLIA)
```

Calldata for `privacy_invoke` (pool deserializes this into the function args):

```
operation, auction_id, lot_token, lot_amount, bid_token, max_bid, min_bid,
bid_end, reveal_end, kind, commitment, bid_id, reveal_amount, reveal_salt,
${openNoteIds[0]}, ${poolAddress}
```

Operations: `0 list · 1 bid · 2 reveal · 3 claim_win · 4 claim_proceeds · 5 claim_refund · 6 claim_unsold`.
