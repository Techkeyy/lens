# Lens disclosure registry

The on-chain half of a Lens disclosure. The bundle itself never goes on chain,
only its digest, which buys three things the bundle cannot give itself:

1. **A timestamp**, so a disclosure cannot be backdated.
2. **An issuer**, so nobody can anchor a bundle that names someone else.
3. **Revocation**, so a proof can be taken back.

The third is the part no privacy chain has today. A Monero proof string or a
Zcash payment disclosure is permanent and forwardable: prove your rent once and
the recipient can pass it around forever. Here the issuer can switch it off and
every verifier sees that immediately.

Revocation stops future verification. It cannot un-see what someone already
read, and the UI says so.

## Interface

| Function | Who | What |
| --- | --- | --- |
| `anchor(digest, expires_at)` | anyone | Records a digest. Caller becomes issuer. Rejected if the digest is already anchored, so an anchor is immutable. `expires_at = 0` means no expiry. |
| `revoke(digest)` | issuer only | Withdraws the disclosure. Once only. |
| `status(digest)` | anyone | `Unknown`, `Valid`, `Revoked` or `Expired`. |
| `is_valid(digest)` | anyone | The same answer as a bool. |
| `get_anchor(digest)` | anyone | Issuer and the three timestamps. |

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
