# STRK20 Privacy Integration Plan — Lens

Generated 2026-08-15 by the [strk20-privacy-integration](https://github.com/starkience/strk20-agent-skills) skill. Statuses below were current at generation time — re-verify the "coming soon" items before building against them.

Product: **look back** (what this address already leaked), **look ahead** (what this next action will leak), **quieter path** (same job, less leaky, signed in the wallet).

## 1. Project snapshot

- Stack: Next.js 16, React 19, `starknet@10.4.0`, `@starknet-io/get-starknet-discovery@6.0.2`, `@starknet-io/get-starknet-wallet-standard@6.0.2`, `@starknet-io/types-js@0.10.3`, zustand. Cairo auction helper exists under `cairo/` — **not used for Lens**; this skill never edits Cairo.
- Relevant code:
  - Connect: `src/app/components/client/WalletHandle/SelectWallet.tsx` (`WalletAccountV6.connect`, `walletV6.requestAccounts`)
  - Account store: `src/app/components/Wallet/walletContext.ts`
  - Network: `src/app/components/client/provider/providerContext.ts` (defaults Sepolia index 2)
  - Pool/RPC: `src/utils/constants.ts`
  - Private actions today: `src/app/vault/page.tsx` (deposit / transfer / withdraw via `strk20InvokeTransaction`)
  - Auction UI (`src/app/lots`, `src/app/new`, `cairo/`) is leftover from Tender — Phase 2 replaces it
- Privacy goal: hide who pays whom on in-pool transfers; **show** the official public edges (deposit/withdraw amount, address, timing) before the user signs; never claim a shield is private.
- Environment: sprint is **mainnet-only** ([Day 0](https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md)). Test against Ready. Xverse dapp API still in progress.

## 2. Chosen route: Privacy Wallet API via starknet.js

Normal dapp. Users connect Ready. The dapp asks the wallet to shield, transfer, or unshield; it never holds a viewing key. Look-back reads the pool's public `Deposit` / withdrawal events — not the transaction sender (that is a relayer). No anonymizer: AVNU already ships private swaps if we ever need one; look-ahead does not need `privacy_invoke`.

**The rule this follows:** this app never touches viewing keys — the user's wallet acts on its behalf via [starknet.js WalletAccountV6](https://strk20-by-example.org/starknet-wallet-api/starknet-js).

## 3. What this delivers — hidden vs visible

Adapted from [compliance](https://strk20-by-example.org/compliance) and [what is STRK20](https://strk20-by-example.org/what-is-strk20):

| Private (inside the pool) | Public (visible onchain) |
|---|---|
| Sender and receiver of a private transfer | Deposit: depositor address, token, amount (`Deposit` event, first indexed key = user) |
| Transfer amounts and token type | Withdrawal: recipient, token, amount |
| Which notes were spent | That an address interacted with the pool, and when |
| Owner of an open note | Open-note **amount** (plaintext by design) |

Honest limits: a shield is never quiet. Distinctive amounts and rapid in-and-out weaken the set (official wording). Bundling a deposit with the transfer it funds publishes the sender and amount next to that transfer. Notes mature ~10 blocks. We do not claim global anonymity-set size. We do not claim amount privacy for helper/DeFi legs.

## 4. Prerequisites & versions

- `starknet@10.4.0` (already pinned)
- Bump `@starknet-io/get-starknet-discovery` and `@starknet-io/get-starknet-wallet-standard` from `6.0.2` → `6.0.3` (skill pin; npm `next` tag)
- `@starknet-io/types-js@0.10.3` (already)
- Test wallet: Ready extension
- Pool (mainnet, official): `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
- RPC start: `https://rpc.starknet.lava.build` ([Day 0](https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md))
- Capability detect: `walletV6.supportedWalletApi` / `supportedSpecs` ≥ 0.10 — **never** `strk20Balances([])` for feature-detect
- Do not use the SDK in the browser

## 5. Phase 1 — first shielded flow ✅ done 2026-08-15

Status: done 2026-08-15

1. Pin get-starknet `6.0.3` in `package.json`.
2. Default network to mainnet in `providerContext.ts` (sprint is mainnet-only). Keep Sepolia as a switch, not the default.
3. In `SelectWallet.tsx`: detect STRK20 with `supportedWalletApi` / `supportedSpecs` ≥ 0.10; hide private actions for Ready-incompatible wallets. Do not probe balances to detect.
4. Keep vault actions in `src/app/vault/page.tsx` but label **deposit as two prompts** (approve, then shield). Name both in the UI.
5. Label shield/unshield as public edges; label transfer as in-pool. Copy from [concepts](https://strk20-by-example.org/what-is-strk20).
6. `waitForTransaction` must have a ceiling (paymaster-relayed hashes).
7. Normalize addresses with `BigInt` before compare (`src/utils/constants.ts` token list).
8. Verify against Ready + https://starknet-wallet-account.vercel.app/

## 6. Phase 2 — Lens (look back / look ahead / quieter path) ✅ done 2026-08-15

Status: done 2026-08-15

1. Replace auction pages (`lots`, `new`, landing) with Lens. Leave `cairo/` in the repo unused; do not generate new Cairo.
2. **Look back** (`src/core/fetch.ts` + detect): query the pool's `Deposit` event filtered on **first indexed key = user address**. Never `transactions where sender == wallet`. Same for withdrawal events (recipient). Rules from official limits: same-amount rapid in-and-out, distinctive amounts, tight succession. Fixture path in `fixtures/` for offline demo.
3. **Look ahead** (`src/core/decide.ts`): score the planned shield / transfer / unshield against that history before `strk20InvokeTransaction`.
4. **Quieter path** (`src/core/rewrite.ts`): wait, change amount, split, or transfer-first. User still signs. Do not auto-bundle deposit + transfer; if UX ever does, label the composition leak.
5. `strk20Balances` only when the user asks to see shielded balance — not for detection.
6. Read pool fee via `get_fee_amount`; subtract from MAX. Do not hardcode 4 STRK in copy as a promise.
7. Tests for detect/decide/rewrite (pure, no RPC).

## 7. Phase 3 — close tracked items ✅ done 2026-08-16

- **Anonymizer:** not built. First-party AVNU private swaps exist if we add a swap tab later. No Cairo.
- **Sub-accounts (Wallet API):** still pending. No UX for them.
- **Xverse dapp Wallet API:** still in progress. Non-Ready wallets stay blocked.
- **Privacy Bridge:** not a dependency.
- **Doctor:** `npm run doctor` checks the official pool class hash and fixture scoring.
- **MAX:** shield MAX uses public STRK `balanceOf` minus live `get_fee_amount`.
- **UI:** Veritable light system on landing, vault, and protocol.

## 8. Testing

- Unit tests on detect/decide/rewrite with `fixtures/sample-history.json`.
- `scripts/doctor.ts`: `getClassHashAt` official pool; optional `PROBE_ADDRESS` for live `Deposit` fetch. Fixture self-check must pass if RPC fails.
- Ready on mainnet, small amounts ([Day 0](https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md)).
- Three successful pool-touching txs into `strk20.json`. Eligibility is the `Deposit` `user_addr`, not the relayer.

## 9. Compliance & security notes

- Deposit screening is onchain; it applies on every route. Surface a declined deposit as screening, not a generic bug.
- Selective disclosure exists for lawful requests; this is not regulator approval.
- No viewing keys, private keys, or secrets in files.
- This skill will not write or edit Cairo.

## 10. Open items to re-verify at build time

- get-starknet 6.0.3 vs 6.0.2 in our lockfile — **pinned 6.0.3**; types-js copies inside `starknet@10.4.0` disagree, so wallet objects are cast at the WalletAccountV6 boundary
- Xverse dapp Wallet API
- Wallet API sub-account method (still absent in types-js 0.10.3)
- `get_fee_amount` live value
- Mainnet discovery/proving URLs (Day 0 still marked some as missing; Wallet API route does not need them)
- `starknet` npm `next` vs `latest`

## 11. Links

- Pool: https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
- Official protocol: https://docs.starknet.io/build/starknet-privacy/overview
- What is STRK20: https://strk20-by-example.org/what-is-strk20
- Compliance / known limits: https://strk20-by-example.org/compliance
- Wallet API: https://strk20-by-example.org/starknet-wallet-api/overview
- starknet.js: https://strk20-by-example.org/starknet-wallet-api/starknet-js
- WalletAccount guide: https://starknet-js.com/docs/next/guides/account/walletAccount/#with-get-starknet-v6
- Sprint Day 0: https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md
- Agent skill: https://github.com/starkience/strk20-agent-skills
- Test dapp: https://starknet-wallet-account.vercel.app/
