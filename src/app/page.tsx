import Link from "next/link";

/**
 * The homepage exists to make one idea land before anyone learns what a
 * shielded pool is: a viewing key opens everything, and Lens opens one line.
 *
 * The comparison is the product, so it sits above the explanation rather than
 * below three feature cards.
 */

const RELATIONSHIPS = [
  { name: "Employer", detail: "6 payments" },
  { name: "Client A", detail: "12 payments" },
  { name: "Client B", detail: "3 payments" },
  { name: "Friend", detail: "1 payment" },
  { name: "Everything later", detail: "forever" },
];

export default function Home() {
  return (
    <div className="wrap">
      <section className="section" style={{ paddingTop: 64 }}>
        <p className="eyebrow">Selective disclosure for STRK20</p>
        <h1 className="statement">
          Show the payment.
          <br />
          <span className="dim">Not the wallet.</span>
        </h1>
        <p className="lede">
          Private payments should not require handing someone your entire financial history.
          Lens discloses one payment relationship, and leaves the rest unreadable.
        </p>
        <div className="hero-actions" style={{ marginTop: 28 }}>
          <Link href="/request" className="btn btn-primary">
            Request a disclosure
          </Link>
          <a href="#how" className="btn btn-ghost">
            See how it works
          </a>
        </div>

        <div className="compare">
          <div className="sheet exposed">
            <div className="sheet-head">
              <h2 className="sheet-title">Master viewing key</h2>
              <span className="sheet-note">The only sharing STRK20 has today</span>
            </div>
            <div className="rows" aria-label="Everything visible under a master viewing key">
              {RELATIONSHIPS.map((r) => (
                <div className="row-item" key={r.name}>
                  <span className="row-name">{r.name}</span>
                  <span className="row-val">{r.detail}</span>
                </div>
              ))}
            </div>
            <p className="sheet-note" style={{ marginTop: 18 }}>
              Every counterparty, every amount, past and future. It cannot be scoped and it
              cannot be taken back.
            </p>
          </div>

          <div className="sheet">
            <div className="sheet-head">
              <h2 className="sheet-title">Lens disclosure</h2>
              <span className="sheet-note">One relationship, frozen at approval</span>
            </div>
            <div className="rows" aria-label="Only the employer relationship is readable">
              <div className="row-item visible-row">
                <span className="row-name">Employer</span>
                <span className="row-val">6 payments</span>
              </div>
              {RELATIONSHIPS.slice(1).map((r, i) => (
                <div className="row-item" key={r.name}>
                  <span className="sr-only">Hidden relationship</span>
                  <span
                    className={`redacted ${i % 3 === 0 ? "w-lg" : i % 3 === 1 ? "w-md" : "w-sm"}`}
                    aria-hidden="true"
                  />
                  <span className="redacted w-sm" aria-hidden="true" />
                </div>
              ))}
            </div>
            <p className="sheet-note" style={{ marginTop: 18 }}>
              The verifier reads one line and checks it against Starknet themselves. The rest
              is not reachable with what they were given.
            </p>
          </div>
        </div>
      </section>

      <section className="section section-gap narrow" id="how">
        <p className="eyebrow">How it works</p>
        <div className="steps">
          <div className="step">
            <h3>Someone asks for proof</h3>
            <p>
              An exchange, a landlord or an accountant fills in what they need and sends you a
              link. They need no wallet and no account.
            </p>
          </div>
          <div className="step">
            <h3>You connect your wallet</h3>
            <p>
              One signature unlocks your own payment history inside your browser. It grants no
              spending power, and the key it derives is never stored or sent anywhere.
            </p>
          </div>
          <div className="step">
            <h3>Lens shows exactly what would be revealed</h3>
            <p>
              Before you agree to anything, you see the relationship, the payments, the totals,
              and a plain list of what stays private.
            </p>
          </div>
          <div className="step">
            <h3>You approve</h3>
            <p>
              One Starknet transaction records that you authorized it. The payments themselves
              never go on chain.
            </p>
          </div>
          <div className="step">
            <h3>They verify it without a wallet</h3>
            <p>
              Their browser checks the payments against the live pool and reads your
              authorization from the registry. Nothing is taken on trust from you or from us.
            </p>
          </div>
          <div className="step">
            <h3>You can revoke the authorization</h3>
            <p>
              Anyone checking the disclosure afterwards sees that you withdrew it, and when.
            </p>
          </div>
        </div>

        <div className="notice" style={{ marginTop: 32 }}>
          <h3>What revocation does not do</h3>
          <p>
            Revocation changes the disclosure&apos;s official authorization status. It cannot
            erase information already viewed or copied, and it cannot recall a channel key
            someone kept.
          </p>
          <p>
            Lens is selective disclosure, not zero knowledge. Everything inside the disclosed
            relationship is revealed in full. The gain is scope: one relationship instead of
            your whole account.
          </p>
        </div>
      </section>

      <section className="section section-gap narrow" style={{ paddingBottom: 80 }}>
        <div className="row-actions">
          <Link href="/request" className="btn btn-primary">
            Request a disclosure
          </Link>
          <Link href="/disclosures" className="btn btn-ghost">
            Manage my disclosures
          </Link>
        </div>
      </section>
    </div>
  );
}
