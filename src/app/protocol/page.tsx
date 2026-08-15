"use client";

import { decide } from "@/core/decide";
import LeakSheet from "../components/LeakSheet";

const SHIELD = decide([], {
  kind: "shield",
  token: "0x1",
  amount: 1n,
});
const TRANSFER = decide([], {
  kind: "transfer",
  token: "0x1",
  amount: 1n,
});
const UNSHIELD = decide([], {
  kind: "unshield",
  token: "0x1",
  amount: 1n,
});

export default function ProtocolPage() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Honest accounting</p>
          <h1>Protocol</h1>
        </div>
      </div>

      <p style={{ color: "var(--text-2)", maxWidth: 640, lineHeight: 1.6, marginBottom: 36 }}>
        Lens is a private dapp on the Wallet API. It does not hold viewing keys,
        does not use sub-accounts (Wallet API still pending), and does not run a
        custom prover. Deposit screening still applies to every shield. Amounts
        on deposit, withdrawal, and helper legs stay visible; movement inside
        the pool does not.
      </p>

      <div className="grid-3" style={{ marginTop: 0, marginBottom: 48 }}>
        <article className="card">
          <p className="eyebrow">Pool</p>
          <h3>STRK20 live</h3>
          <p>
            Mainnet pool. Look-back reads <code>Deposit.user_addr</code> and{" "}
            <code>Withdrawal.to_addr</code>, not the relayer.
          </p>
        </article>
        <article className="card">
          <p className="eyebrow">Wallet</p>
          <h3>Ready</h3>
          <p>
            Shield, send, and unshield go through WalletAccountV6. The app never
            sees a viewing key.
          </p>
        </article>
        <article className="card">
          <p className="eyebrow">Fee</p>
          <h3>On-chain</h3>
          <p>
            Fee comes from <code>get_fee_amount</code>. It is reserved on MAX,
            not hard-coded as 4 STRK.
          </p>
        </article>
      </div>

      <div style={{ marginTop: 24 }}>
        <h2
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 400,
            fontSize: 40,
            marginBottom: 8,
          }}
        >
          Leak sheets
        </h2>
        <LeakSheet score={SHIELD} />
        <LeakSheet score={TRANSFER} />
        <LeakSheet score={UNSHIELD} />
      </div>
    </div>
  );
}
