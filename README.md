# Lens

See what a STRK20 action still reveals. A privacy briefing for anyone about to shield, send, or unshield on Starknet.

**[Hidden vs visible](./docs/HIDDEN-VS-VISIBLE.md)** · **[Fixture the scorer grades](./fixtures/sample-history.json)** · **[Demo script](./docs/DEMO.md)** · [Source](https://github.com/Techkeyy/lens)

> "I just shielded. Am I actually hidden, or did I just publish a door?"

STRK20 Private Sprint entry. Hub listing: [strk20.starknet.io/hackathon](https://strk20.starknet.io/hackathon). There is no hosted demo URL yet. `strk20.json` transactions and `demo_video` are empty on purpose. Clone this repo to try it.

## Why this exists

Ready, the official app, and most sprint entries let you **do** a shield. They stop at the wallet prompt. They do not tell you that this deposit amount and this timing are the official leak list.

```
  YOU CLICK SHIELD                 starter kits show this
  approve + deposit  ---------->  note is encrypted
         |
         |     official docs already name this
         v
  public Deposit: address, token, amount, time
         |
         +-- same amount out in 30 min  =  loud in-and-out
         +-- private send in that window = noisy glue
```

Lens fills that gap by scoring those public edges **before** you sign.

## What it does

1. **Looks back.** Reads pool `Deposit.user_addr` and `Withdrawal.to_addr` for the connected address. Output: a list of public edges. Never uses the relayer `sender`.
2. **Looks ahead.** Runs `decide()` on the planned shield, send, or unshield plus that history. Output: grade `quiet` / `noisy` / `loud` and a hidden-vs-visible sheet.
3. **Rewrites.** `rewrite()` offers wait, split, change amount, or transfer first. Output: a new planned action. You still confirm in Ready.
4. **Clocks the wait.** If this click is still inside the 30-minute window, the vault shows `Quiet after {UTC}` and the wait button uses the remaining time, not a flat "30 minutes".

Trust property: grades are deterministic TypeScript. No LLM. No viewing key. Capability detect is Wallet API `>= 0.10`, never a `strk20Balances` probe.

## Quickstart

```bash
npm install
cp .env.example .env.local
# optional: NEXT_PUBLIC_ALCHEMY_KEY=   (Alchemy key only, never commit)
npm test
npm run doctor
npm run dev
```

Open http://localhost:3000. Without a key, mainnet RPC is `https://rpc.starknet.lava.build`.

Offline path: `npm test` scores `fixtures/sample-history.json` (10 STRK in, 10 STRK out three minutes later) and must print `loud`. The landing page renders that same score.

Need Ready on Starknet mainnet for live vault actions.

## Architecture

| Module | Job |
| --- | --- |
| `src/core/detect.ts` | Flag official public-edge leaks on history |
| `src/core/decide.ts` | Grade the next action. Public doors never `quiet` |
| `src/core/rewrite.ts` | Offer wait, split, amount change, transfer-first |
| `src/core/clock.ts` | Quiet-after timestamp from the latest relevant door |
| `src/core/fetch.ts` | Read Deposit / Withdrawal keys, last 80,000 blocks |
| `src/core/fixture.ts` | Load the committed offline history |
| `src/lib/strk20.ts` | Wallet API invoke + wait ceiling |
| `src/app/vault/page.tsx` | Connect Ready, scan, score, sign |
| `scripts/doctor.ts` | Live pool class hash + fixture self-check |

## Why the leak-briefing lane matters

[IDEA-25](https://github.com/starkience/strk20-hackathon/blob/main/IDEAS.md) asked for a pre-sign privacy simulator. We do not invent an anonymity-set size (the docs do not publish one). A sprint peer (Cutout) already owns pool-wide amount cover. Lens clocks **your** public doors: look back, look ahead, quiet-after.

This is not [RFP-08](https://github.com/starkience/strk20-hackathon/blob/main/IDEAS.md) and not [tinoxbt/sealed](https://github.com/tinoxbt/sealed). Sealed bids are a different product. Proof: the fixture card on the home page is a real `decide()` result (`loud`), not a mock dashboard.

## How I tried to break it

`npm test` is **18** vitest cases in `src/core/detect.test.ts`.

| Input | Result |
| --- | --- |
| Fixture: 10 STRK in, 10 STRK out 3 minutes later | `loud` (rapid same-amount in-and-out) |
| Pair 1s after the 30-minute window | Not flagged |
| Pair sitting exactly on 30 minutes | Still flagged |
| Same amount, different tokens | No pair |
| Two identical deposit amounts | Not distinctive |
| Zero-amount shield | Ignored, not a fingerprint |
| Empty history | `no-public-edges`, never implied private |
| Lone shield | Floor `noisy` (door is public) |
| Lone unshield | `noisy`, no fake "wait out the window" |
| Private send next to a recent door | `noisy` |
| Lone in-pool transfer | `quiet` |
| Matching unshield 10 min after a deposit | Wait button uses remaining time (`quiet after`), not a flat 30m |
| Lone shield | No quiet-after clock |

**A shield or unshield never returns `quiet`.** Missing history is not treated as privacy.

Rules decide the grade. Ready only signs.

## What it does not (yet)

- Three scoring hashes: `strk20.json` `transactions` is `[]`.
- Hosted demo URL and 3-minute video: empty. Record from [docs/DEMO.md](./docs/DEMO.md).
- Genesis look-back: last 80,000 blocks only.
- AVNU anonymizer, Wallet API sub-accounts, Xverse: upstream, not faked.
- Cairo in this app: leftover `cairo/` is unused starter-kit auction code.
- Mixer claims: careless amounts and timing still link doors.

## STRK20: what we used

Privacy Wallet API via starknet.js `WalletAccountV6` (`get-starknet` 6.0.3, `types-js` 0.10.3). Live `get_fee_amount` on MAX. Event filters on `Deposit` / `Withdrawal` keys, not transaction senders.

No issues filed against the official repos from this project. Registry row: [`Techkeyy/lens`](https://github.com/starkience/strk20-hackathon/blob/main/registry.json), telegram `iszee23`. Category stays derived `Other` (we did not open a second registry PR).

Pool: [`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a).

## License

[Apache-2.0](./LICENSE). Wallet connect follows the [STRK20 starter kit](https://github.com/Akashneelesh/strk20-starter-kit).
