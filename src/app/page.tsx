import Link from "next/link";

export default function Home() {
  return (
    <>
      <header className="hero">
        <p className="eyebrow">IDEA-25 · official leak list</p>
        <h1>See what this STRK20 action still reveals.</h1>
        <p>
          Inside the pool, who paid whom is hidden. The doors are not. Deposits
          and withdrawals publish your address, the token, the amount, and the
          time. Lens scores that before you sign, and offers a quieter path.
        </p>
        <div className="hero-actions">
          <Link href="/vault" className="btn btn-primary">
            Open the vault
          </Link>
          <Link href="/protocol" className="btn btn-ghost">
            What stays public
          </Link>
        </div>
      </header>

      <section className="band band-alt" id="three">
        <div className="band-inner">
          <p className="eyebrow">Three features</p>
          <h2>Look back. Look ahead. Take the quieter path.</h2>
          <div className="grid-3">
            <article className="card">
              <p className="eyebrow">01</p>
              <h3>Look back</h3>
              <p>
                We read the pool’s Deposit and Withdrawal events for your
                address — never the relayer that submitted the transaction.
              </p>
            </article>
            <article className="card">
              <p className="eyebrow">02</p>
              <h3>Look ahead</h3>
              <p>
                Before you confirm, we grade this next shield, send, or
                unshield against that history. Loud means a watcher can pair it.
              </p>
            </article>
            <article className="card">
              <p className="eyebrow">03</p>
              <h3>Quieter path</h3>
              <p>
                Wait, split, change the amount, or transfer first. You still
                sign. We do not pretend a shield can be quiet.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="band" id="honest">
        <div className="band-inner">
          <p className="eyebrow">From the docs, not a vibe</p>
          <h2>We only claim what STRK20 actually hides.</h2>
          <p className="lead">
            Distinctive amounts and rapid in-and-out weaken the set. Bundling a
            deposit with the transfer it funds publishes the sender. Notes need
            time to mature. Lens writes that on the button.
          </p>
          <div className="hero-actions">
            <Link href="/vault" className="btn btn-primary">
              Score an action
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
