# Lens

**See what a STRK20 action still reveals, then take a quieter path.**

[Hub](https://strk20.starknet.io/hackathon) · [Source](https://github.com/Techkeyy/lens) · [Hidden vs visible](./docs/HIDDEN-VS-VISIBLE.md) · [Demo script](./docs/DEMO.md)

Live demo URL and three mainnet hashes are still empty in [`strk20.json`](./strk20.json). Until those land, this repo is the product a judge can clone and run. Do not treat an empty field as a deployed proof.

## Why this exists

Most privacy mistakes happen after someone already believed they were hidden. Inside the STRK20 pool, who paid whom stays hidden. The doors do not. Deposits and withdrawals publish address, token, amount, and time. Official docs name distinctive amounts and rapid in-and-out as leaks.

Other sprint apps are another shield button. Lens is a briefing: score the next click against this address’s public pool edges **before** Ready asks you to sign.

Inspired by [IDEA-25](https://github.com/starkience/strk20-hackathon/blob/main/IDEAS.md) and the pool’s [known limits](https://strk20-by-example.org/compliance). Not RFP-08; sealed-bid auctions are a different lane.

## What it does

1. **Look back** — pool `Deposit.user_addr` and `Withdrawal.to_addr` for the connected address. Never the relayer `sender`.
2. **Look ahead** — grade this shield, send, or unshield against that history. A shield is never `quiet`.
3. **Quieter path** — wait, split, change the amount, or transfer first. You still confirm in Ready.

Route: [Privacy Wallet API](https://strk20-by-example.org/starknet-wallet-api/overview) via starknet.js `WalletAccountV6`. The app never holds a viewing key.

## How I tried to break it

`npm test` — **14** vitest cases in `src/core/detect.test.ts`.

| Input | What a sloppy scorer would do | What Lens does |
| --- | --- | --- |
| Fixture: 10 STRK in, 10 STRK out 3 minutes later | Call it private because it used the pool | `loud` — official rapid same-amount in-and-out |
| Pair 1s after the 30-minute window | Still flag it | No rapid-in-out |
| Pair sitting exactly on 30 minutes | Miss the edge | Still flagged |
| Shield and unshield, same amount, different tokens | Pair them | No pair |
| Two identical deposit amounts | Call each distinctive | Distinctive only when the figure appears once |
| Zero-amount shield | Treat as a fingerprint | Ignored |
| Empty history | Imply the address is private | `no-public-edges` — empty is not private forever |
| Lone shield | Grade `quiet` because no extra pattern | Floor is `noisy` — the door is public |
| Lone unshield | Offer “wait out the window” | Public-edge `noisy`, no fake wait |
| Private send next to a recent door | Grade `quiet` | `noisy` — timing can glue them |
| Lone in-pool transfer | Over-warn | `quiet` — this is the private action |

## What it does not (yet)

- **No three scoring hashes.** `strk20.json` `transactions` is `[]`. Eligibility is the pool `Deposit` `user_addr`, not the relayer. Fill after Ready mainnet clicks.
- **No hosted demo URL / video.** `demo_url` and `demo_video` are empty. Record from [docs/DEMO.md](./docs/DEMO.md).
- **No global anonymity-set size.** IDEA-25 mentions it; the official docs do not publish a number we can score. We refuse to invent one.
- **Look-back is the last 80,000 blocks** on the configured RPC, not genesis.
- **No AVNU anonymizer, no sub-accounts, no Xverse.** Wallet API sub-accounts and Xverse dapp API are still upstream. Non-Ready wallets stay blocked.
- **No Cairo from this app.** Leftover `cairo/` is unused starter-kit auction code.
- **Not a mixer.** Careless amounts and timing still link the doors.

## Run

Node 20+ and a [Ready](https://www.ready.co/) wallet on **Starknet mainnet**.

```bash
npm install
cp .env.example .env.local
# optional: set NEXT_PUBLIC_ALCHEMY_KEY (key only, never commit)
npm test
npm run doctor
npm run dev
```

Open http://localhost:3000 → **Score this next action**.

Without an Alchemy key, public RPCs are used (`https://rpc.starknet.lava.build` on mainnet).

## Sprint metadata

| | |
| --- | --- |
| Registry | [`Techkeyy/lens`](https://github.com/starkience/strk20-hackathon/blob/main/registry.json), telegram `iszee23` |
| Category (derived) | Other — we did not open a second registry PR |
| License | Apache-2.0 |
| Pool | [`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a) |
| Plan | [STRK20_INTEGRATION_PLAN.md](./STRK20_INTEGRATION_PLAN.md) |
| Design | [DESIGN.md](./DESIGN.md) |

Wallet connect flow follows the [STRK20 starter kit](https://github.com/Akashneelesh/strk20-starter-kit).
