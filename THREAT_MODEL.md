# Threat model

What Lens protects against, and what it does not. The second list is longer on
purpose. A privacy tool that overstates its guarantees is worse than one that
states modest guarantees accurately, because people make decisions on the
strength of the claim.

## Roles

| Role | Who | Holds keys |
| --- | --- | --- |
| **Holder** | the person whose payment history is disclosed | yes, their own viewing key, in memory only |
| **Counterparty** | the address the disclosed relationship is with | not involved in the disclosure at all |
| **Verifier** | whoever asked to see it | none, ever |

The Counterparty and the Verifier are usually different people. An employer pays
Alice privately. A landlord asks Alice to prove that income. Alice is the Holder,
the employer is the Counterparty, the landlord is the Verifier, and the employer
is never asked for anything.

## Protected against

**The Verifier receiving the Holder's master viewing key.** A disclosure carries
channel keys for one relationship. A channel key is a Poseidon output over the
viewing key, so it cannot be inverted back to it. Four tests assert the viewing
key appears in no payload, no link and no commitment.

**The Verifier seeing unrelated counterparties.** Channel keys are per
relationship and per direction. A key for the employer lane locates only notes
in that lane; other relationships use unrelated keys and are not reachable.

**A Holder attributing someone else's payments to a named Counterparty.** The
pool's public `channel_exists` binds a key to a specific sender, recipient and
registered public key. A lane funded by a third party and presented as the
employer's fails verification, and the test that proves it is in
`src/core/claim.test.ts`.

**Tampering with an issued disclosure.** The on-chain commitment covers the
scope, the directions, the keys and the asserted total. Editing any of it
produces a different commitment, which then matches no authorization.

**Backdating.** `authorize` refuses a commitment that already exists, so a
record is immutable and its timestamp cannot be rewritten.

**Passing off a revoked disclosure as current.** Status is read live from the
chain by the Verifier's own browser, not asserted by the disclosure.

**Silent over-disclosure.** The consent preview computes the real boundary
before the Holder approves, and states plainly when the relationship is wider
than the period the Verifier asked about.

**Our server seeing anything.** There is no server in the path. Keys are derived
in the browser, the disclosure travels between two people out of band, and
verification is public chain reads.

## Not protected against

**The Verifier keeping what they saw.** Screenshots, copy and paste, notes on
paper. Nothing in any blockchain can recall information a person has read.

**Revocation erasing anything.** Revocation withdraws authorization and makes
that withdrawal publicly checkable. It does not delete copies, and it does not
stop retained key material from working.

**Retained channel keys.** This is the most important limitation in the MVP. A
channel key is reusable. A Verifier who keeps it can continue to read that one
relationship, including payments made *after* the disclosure was created,
because the key does not expire and cannot be recalled. Revocation changes the
authorization status a Verifier is shown, not the arithmetic they could run
themselves.

Consequence: **treat a disclosure as permanently sharing that one relationship
with that one Verifier.** The UI says this before approval. Removing this
limitation needs bounded, snapshot-style disclosure that hands over a proof
rather than a key, which is designed for but not built.

**Payment-level selection.** The boundary is the relationship, not the
individual payment. A Verifier asking about June gets the whole lane, and the
Holder is told so before approving.

**Proving absence.** A disclosure proves payments happened. It can never prove
that other payments did not. A Holder can truthfully prove one client paid them
while saying nothing about a larger one, so a Verifier must not read a
disclosure as a complete financial picture. The verifier page says this on
screen.

**A compromised Holder device, wallet or browser.** A malicious extension can
read anything the page can read, including the derived viewing key while it is
in memory.

**Public pool metadata.** Deposits and withdrawals are public by design:
addresses, amounts and timing. Lens does not hide them and does not claim to.
Timing correlation between a public deposit and a public withdrawal is outside
this product entirely.

**Collusion.** A Counterparty and a Verifier who compare notes learn more than
either alone. Nothing here prevents that.

**The pool's own auditor escrow.** STRK20 encrypts each user's private viewing
key to an auditor key at registration. That is a property of the protocol, not
of Lens, and it exists whether or not a Holder ever uses this product.

## Not claimed

Lens is **selective disclosure**, not zero knowledge. The payments inside the
disclosed relationship are revealed in full to the Verifier. The privacy gain
comes from narrowing the scope from an entire account to one relationship, not
from hiding the contents of that relationship.

Anyone describing this as a zero-knowledge proof, or as revealing no
information, is describing something we did not build.
