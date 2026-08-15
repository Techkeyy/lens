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
            Score this next action
          </Link>
          <Link href="/protocol" className="btn btn-ghost">
            What stays public
          </Link>
        </div>
      </header>

      <section className="band band-alt" id="why">
        <div className="band-inner">
          <p className="kicker">Why it exists</p>
          <h2>Most privacy mistakes happen after someone already believed they were hidden.</h2>
          <p className="lead">
            Deposits and withdrawals publish address, token, amount, and time.
            Distinctive amounts and a fast in and out weaken the set. Lens writes
            that next to the button.
          </p>
        </div>
      </section>

      <section className="band" id="how">
        <div className="band-inner">
          <p className="kicker">How it works</p>
          <h2>Look back. Look ahead. Take the quieter path.</h2>
          <ol className="steps">
            <li className="step">
              <span className="step-n">01</span>
              <div>
                <h3>Look back</h3>
                <p>
                  Reads the pool Deposit and Withdrawal events for your address.
                  Never the relayer that submitted the transaction.
                </p>
              </div>
            </li>
            <li className="step">
              <span className="step-n">02</span>
              <div>
                <h3>Look ahead</h3>
                <p>
                  Grades this next shield, send, or unshield against that history
                  before you confirm.
                </p>
              </div>
            </li>
            <li className="step">
              <span className="step-n">03</span>
              <div>
                <h3>Quieter path</h3>
                <p>
                  Wait, split, change the amount, or transfer first. You still
                  sign. A shield is never called quiet.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>
    </>
  );
}
