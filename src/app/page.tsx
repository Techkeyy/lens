import Link from "next/link";

export default function Home() {
  return (
    <>
      <header className="hero">
        <p className="kicker">Ready wallet. Live pool.</p>
        <h1>See what this action still reveals.</h1>
        <p>
          Inside the pool, who paid whom stays hidden. The doors do not. Lens
          scores a shield, send, or unshield before you sign, then offers a
          quieter path.
        </p>
        <div className="hero-actions">
          <Link href="/vault" className="btn btn-primary">
            Open vault
          </Link>
          <Link href="/protocol" className="btn btn-ghost">
            What stays public
          </Link>
        </div>
      </header>

      <section className="band band-alt" id="entry">
        <div className="band-inner">
          <div className="grid-3" style={{ marginTop: 0 }}>
            <article className="card" style={{ gridColumn: "span 2" }}>
              <p className="kicker">Why it exists</p>
              <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", maxWidth: "16ch" }}>
                Most privacy mistakes happen after someone already believed they were hidden.
              </h2>
              <p className="lead">
                Deposits and withdrawals publish address, token, amount, and time.
                Distinctive amounts and a fast in and out weaken the set. Lens
                writes that next to the button.
              </p>
            </article>
            <article className="card">
              <p className="kicker">Start</p>
              <h3>Connect Ready</h3>
              <p>Then scan your public edges and score the next click.</p>
              <Link href="/vault" className="btn btn-primary" style={{ marginTop: 20 }}>
                Go to vault
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section className="band" id="how">
        <div className="band-inner">
          <p className="kicker">How it works</p>
          <h2>Look back. Look ahead. Take the quieter path.</h2>
          <div className="grid-3">
            <article className="card">
              <p className="kicker">01</p>
              <h3>Look back</h3>
              <p>
                Reads the pool Deposit and Withdrawal events for your address.
                Never the relayer that submitted the transaction.
              </p>
            </article>
            <article className="card">
              <p className="kicker">02</p>
              <h3>Look ahead</h3>
              <p>
                Grades this next shield, send, or unshield against that history
                before you confirm.
              </p>
            </article>
            <article className="card">
              <p className="kicker">03</p>
              <h3>Quieter path</h3>
              <p>
                Wait, split, change the amount, or transfer first. You still
                sign. A shield is never called quiet.
              </p>
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
