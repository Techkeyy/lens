import Link from "next/link";

export default function Home() {
  return (
    <>
      <header className="hero">
        <p className="eyebrow">RFP-08 · sealed-bid auctions</p>
        <h1>Bid what it is worth. Nobody sees until it is over.</h1>
        <p>
          Tender is a Vickrey house on the STRK20 pool. Every bidder posts the same
          public deposit. The real number lives in a commitment until the reveal
          window. Then the second price clears, and the lot moves back into a
          private note.
        </p>
        <div className="hero-actions">
          <Link href="/lots" className="btn btn-primary">
            Open the board
          </Link>
          <Link href="/protocol" className="btn btn-ghost">
            How the seal works
          </Link>
        </div>
      </header>

      <section className="band band-alt" id="why">
        <div className="band-inner">
          <p className="eyebrow">Why this exists</p>
          <h2>Transparent books make honest bidding irrational.</h2>
          <p className="lead">
            On a public chain, the first bid anchors the room. Bots snipe the last
            second. Whales intimidate. Vickrey auctions fix the incentive — bid
            your true value — but only if the bid is actually sealed. Commit-reveal
            without escrow lets people walk away. Tender locks the max bid in the
            helper, and keeps the real number hashed until everyone opens at once.
          </p>
          <div className="grid-3">
            <article className="card">
              <p className="eyebrow">01</p>
              <h3>Uniform deposits</h3>
              <p>
                Every bid transfers exactly <em>max bid</em> from the pool to the
                helper. Observers see a bid happened. They do not see how much you
                meant.
              </p>
            </article>
            <article className="card">
              <p className="eyebrow">02</p>
              <h3>Second price</h3>
              <p>
                Vickrey is the default. The winner pays the second-highest revealed
                bid, or the reserve if they stood alone. First-price is an option
                on the same contract.
              </p>
            </article>
            <article className="card">
              <p className="eyebrow">03</p>
              <h3>Private settlement</h3>
              <p>
                Claims run through <span className="num">privacy_invoke</span>. The
                lot, the proceeds, and the refunds land in open notes. The helper
                is the only public counterparty.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="band" id="phases">
        <div className="band-inner">
          <p className="eyebrow">Four phases</p>
          <h2>List. Seal. Open. Settle.</h2>
          <table className="phase-table">
            <thead>
              <tr>
                <th>Phase</th>
                <th>What you do</th>
                <th>What the chain sees</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>List</td>
                <td>Seller shields the lot, then posts it through the anonymizer. Clock and reserve are public parameters.</td>
                <td>Lot token, size, max bid, deadlines. Not the seller.</td>
              </tr>
              <tr>
                <td>Bid</td>
                <td>You pick a number at or below the max, hash it with a salt, and deposit the max.</td>
                <td>A commitment and another max-bid transfer. Not the number. Not you.</td>
              </tr>
              <tr>
                <td>Reveal</td>
                <td>After bidding closes, you open the commitment from the same wallet flow. The salt never leaves your browser until then.</td>
                <td>The amount, bound to a bid id. Still not the wallet that funded it.</td>
              </tr>
              <tr>
                <td>Settle</td>
                <td>Anyone can settle after the reveal window. Winner claims the lot. Seller claims the price. Everyone else takes their deposit home.</td>
                <td>Winning id and clearing price. Claims return value to the pool.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="band band-alt" id="depth">
        <div className="band-inner">
          <p className="eyebrow">STRK20 depth</p>
          <h2>The wallet holds the viewing key. Tender never asks for it.</h2>
          <p className="lead">
            Shield, private transfer, unshield, and every auction move go through
            WalletAccountV6. The anonymizer is a stateful helper — list, bid,
            reveal, claim — not an echo. What stays public is written down next to
            every button.
          </p>
          <div className="stat-row">
            <div className="stat">
              <div className="num n">30%</div>
              <div className="l">Integration depth</div>
            </div>
            <div className="stat">
              <div className="num n">7</div>
              <div className="l">Helper operations</div>
            </div>
            <div className="stat">
              <div className="num n">2</div>
              <div className="l">Auction kinds</div>
            </div>
            <div className="stat">
              <div className="num n">0</div>
              <div className="l">Viewing keys in the app</div>
            </div>
          </div>
        </div>
      </section>

      <section className="band" id="start">
        <div className="band-inner">
          <p className="eyebrow">Ready wallet · mainnet or sepolia</p>
          <h2>Start in the vault, then put a lot on the board.</h2>
          <p className="lead">
            Shield STRK first. Listing and bidding spend private notes, not your
            public balance. If the helper is not deployed on this network yet, the
            vault still talks to the live pool.
          </p>
          <div className="hero-actions">
            <Link href="/vault" className="btn btn-primary">
              Open vault
            </Link>
            <Link href="/new" className="btn btn-ghost">
              List a lot
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
