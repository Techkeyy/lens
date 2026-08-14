# Lens

See what a STRK20 action still reveals, then take a quieter path.

Privacy on Starknet is real inside the pool. The doors are not. Deposits and withdrawals publish your address, the token, the amount, and the time. Distinctive amounts and rapid in-and-out are named leaks in the official docs. Lens scores those edges **before you sign**.

STRK20 Private Sprint entry. Inspired by [IDEA-25](https://github.com/starkience/strk20-hackathon/blob/main/IDEAS.md) and the pool’s own [known limits](https://strk20-by-example.org/compliance).

## Three features

1. **Look back** — what this address already made obvious (pool `Deposit` / withdraw events; never the relayer `sender`).
2. **Look ahead** — if I do this next, what stays hidden and what does not.
3. **Quieter path** — wait, split, change amount, or transfer first. You still confirm in Ready.

The app never holds a viewing key. Route: [Privacy Wallet API](https://strk20-by-example.org/starknet-wallet-api/overview) via starknet.js.

## Run

Node 20+ and a [Ready](https://www.ready.co/) wallet.

```bash
npm install
cp .env.example .env.local
# set NEXT_PUBLIC_ALCHEMY_KEY (key only, never commit)
npm run dev
```

Get a free Alchemy key at https://www.alchemy.com. Mainnet RPC shape:

`https://starknet-mainnet.g.alchemy.com/v2/<YOUR_ALCHEMY_KEY>`

Without a key, public RPCs are used.

## Sprint metadata

- Pool: [`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
- Plan: [STRK20_INTEGRATION_PLAN.md](./STRK20_INTEGRATION_PLAN.md)
- `strk20.json` at the repo root (fill txs, demo, video as they land)

## License

Apache-2.0. Wallet connect flow follows the [STRK20 starter kit](https://github.com/Akashneelesh/strk20-starter-kit).
