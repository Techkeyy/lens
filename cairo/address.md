# Lens disclosure registry

## sepolia

- deployed: 2026-08-24
- class hash: `0x767bfcbdf3fcebc0836cd1d050aa4daed9ec1d10e152f59df222e708ea2e616`
- address: `0x51056eb3f8f9408185c9ee9fbfab94f3a5d47c7369a3a72c8783296d1d1b936`

## mainnet

- deployed: 2026-08-25
- class hash: `0x767bfcbdf3fcebc0836cd1d050aa4daed9ec1d10e152f59df222e708ea2e616`
- address: `0x7e14bc65e5f759da2a981843c485a948dc6e15548fe0ba51e3ca805ca75fb01`
- deployment block: `13815987`

Both addresses are checked into `src/utils/networks.ts` as defaults, so no
environment variable is needed to build. To point a build at a different
deployment, override:

```
NEXT_PUBLIC_REGISTRY_MAINNET=...
NEXT_PUBLIC_REGISTRY_FROM_BLOCK_MAINNET=...
```

Mainnet declare `0x6124e178200e715c9c0e6c2c6ed08bf1ea3a46a4b8b11b96e595abe0ff6f12d`,
deploy `0x4b41314ed39bc6d41b6791e4550c804e40da8e00b26c8cc8a36fa4b17e1d9d6`.
