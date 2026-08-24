# Lens disclosure registry

The on-chain half of a Lens disclosure. The bundle itself never goes on chain,
only its digest, which buys three things the bundle cannot give itself:

1. **A timestamp**, so a disclosure cannot be backdated.
2. **An issuer**, so nobody can anchor a bundle that names someone else.
3. **Revocation**, so a proof can be taken back.

Revocation moves the authorization to REVOKED, and anyone checking the
disclosure afterwards sees that the Holder withdrew it, and when.

Revocation does not erase what a Verifier already saw, copied or screenshotted,
and it does not stop retained channel material from decrypting. It governs
authorization status, not the reach of information already released. Never
describe it as making a disclosure "stop working" or making copies "expire":
those words would be false.

## Interface

| Function | Who | What |
| --- | --- | --- |
| `authorize(commitment, expires_at)` | anyone | Records a commitment. Caller becomes its Holder. Rejected if already authorized, so a record is immutable. `expires_at = 0` means it does not lapse. |
| `revoke(commitment)` | Holder only | Withdraws authorization. Once only. |
| `status(commitment)` | anyone | `Unknown`, `Active`, `Revoked` or `Expired`. |
| `is_authorized(commitment)` | anyone | The same answer as a bool. |
| `get_authorization(commitment)` | anyone | Holder and the three timestamps. |

Every read is public, in keeping with the rule that a verifier needs no wallet.

## Build

Requires the pinned toolchain in `.tool-versions`.

```bash
scarb build
```

If `scarb` is missing, the pinned version is `2.18.0`. It was installed here by
downloading `scarb-v2.18.0-x86_64-pc-windows-msvc.zip` from the
[official releases](https://github.com/software-mansion/scarb/releases/tag/v2.18.0)
and extracting it, then adding its `bin` directory to `PATH`. On Linux or macOS
`asdf install scarb 2.18.0` does the same job.

## Deploy

```bash
npx tsx scripts/deploy-registry.ts
```

Sepolia by default, `--mainnet` for the real one. Needs a funded deployer in
`.env.local` (`SEPOLIA_PRIVATE_KEY` and `SEPOLIA_ADDRESS`). Deployed addresses
are written into `address.md` by the script, so the deployment is recorded in
the repo rather than in a shell history.

## Testing

Contract behaviour is proven by deploying to Sepolia and exercising it from
`scripts/`, rather than by a Cairo unit-test harness. One real transaction
against a real node is worth more here than a mocked assertion, and the same
script doubles as the deployment path.
