# Development evidence

Testnet only. Nothing here belongs in `strk20.json`, which carries mainnet
submission evidence and stays empty until mainnet transactions exist.

## Sepolia registry, 2026-08-24

Full authorization lifecycle exercised against the deployed contract through
the same TypeScript client the interface will use.

| Item | Value |
| --- | --- |
| Network | Starknet Sepolia |
| Class hash | `0x767bfcbdf3fcebc0836cd1d050aa4daed9ec1d10e152f59df222e708ea2e616` |
| Contract | `0x51056eb3f8f9408185c9ee9fbfab94f3a5d47c7369a3a72c8783296d1d1b936` |
| Declare | `0x6031e82f3a5c7efcb17b9ba37b0f5f804d86c60d2d95064f972fbf10bcfff6` |
| Deploy | `0x1362efc97f3891e28d0500b7ddf0d279d03668cfd27187dfaa706d9946addc7` |
| Authorize | `0x799d98e42809690b030ad513def56d4cff6c4124ab7d10b2a845c330cd2882e` |
| Revoke | `0x5139f235ebe869c4f1ec4199d83dfdf6a04f3ad6f0377cc4d2d130958b2e20a` |
| Deployer | `0x56d8c42a83dc976ea0bf367639c0b5ce4f42ea262ae8d1a046f710e13659124` |

Observed transitions, read by a provider holding no keys:

```
Unknown  ->  Active  ->  Revoked
```

and `listHolderAuthorizations` rebuilt the record from chain events alone:
commitment, creation time and current status, with no counterparty and no
amounts, exactly as intended.

Reproduce with:

```bash
npx tsx scripts/registry-rehearsal.ts
```

The commitment used is a throwaway hash of a timestamp. No real disclosure and
no key material was involved.

## The declare fee, and why `--tight` exists

starknet.js pads both the gas amount and the gas price by 1.5x when it builds
resource bounds, so the declared worst case is about 2.25x the real cost. On a
funded-just-enough account the node then rejects the transaction with "resource
bounds exceed balance" even though the account can comfortably afford it.

Measured on Sepolia:

| | STRK |
| --- | --- |
| Default bounds worst case | 8.77 |
| Real cost | ~3.90 |
| Account balance | 4.93 |

`scripts/deploy-registry.ts --tight` rebuilds the bounds from the raw estimate:
the 1.5x is undone, then 6% is added to the gas amount and 8% to the price. Gas
amount for a declare is deterministic, so the margin is really about the price
moving between estimate and inclusion. That produced a 4.46 STRK worst case and
the declare went through.

The same flag will be needed on mainnet unless the deployer is funded well above
the padded estimate.

## Faucet blocker

The Sepolia faucet's public agent API accepted a drip on 2026-08-19 and now
rejects an identical request:

```
POST /api/public-agent/faucet/request
400 POW_CHALLENGE_INVALID
"Proof-of-work challenge does not match this address or network."
```

The challenge endpoint still returns 201 with the same shape, so this is not the
24 hour address cooldown, which surfaces separately as `429 ADDRESS_COOLDOWN`.
Variants tried, all rejected identically: zero-padded address, the address the
server echoes back, a `network` field on both calls, and the nonce as a JSON
number rather than a string. The proof of work itself is correct by the server's
own stated algorithm.

This blocked further Sepolia funding, which is why the declare had to fit inside
the existing balance rather than being topped up first.
