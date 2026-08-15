import Link from "next/link";
import LeakSheet from "./components/LeakSheet";
import RevealHeading from "./components/RevealHeading";
import { decide } from "@/core/decide";
import { loadFixture } from "@/core/fixture";
import { addrSTRK } from "@/utils/constants";

const fixture = loadFixture();
const cashOut = fixture.find((e) => e.kind === "unshield") ?? fixture[0];
const fixtureScore = decide(fixture, {
  kind: "unshield",
  token: cashOut?.token ?? addrSTRK,
  amount: cashOut?.amount ?? 10n ** 19n,
  at: cashOut?.timestamp,
});

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
        <div className="band-inner split">
          <div>
            <p className="kicker">Why it exists</p>
            <RevealHeading>Most privacy mistakes happen after someone already believed they were hidden.</RevealHeading>
            <p className="lead">
              Deposits and withdrawals publish address, token, amount, and time.
              Distinctive amounts and a fast in and out weaken the set. Lens writes
              that next to the button.
            </p>
          </div>
          <article className="console fixture-card">
            <p className="kicker">Committed fixture</p>
            <p className={`receipt-head ${fixtureScore.grade}`}>{fixtureScore.grade.toUpperCase()}</p>
            <p className="muted">
              10 STRK in, then the same 10 STRK out three minutes later. This is
              the official rapid in-and-out pattern, scored by the same function
              the vault uses.
            </p>
            <LeakSheet score={fixtureScore} />
          </article>
        </div>
      </section>

      <section className="band" id="how">
        <div className="band-inner">
          <p className="kicker">How it works</p>
          <RevealHeading>Look back. Look ahead. Take the quieter path.</RevealHeading>
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
