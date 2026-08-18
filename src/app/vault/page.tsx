"use client";

import { useEffect, useMemo, useState } from "react";
import { num } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import SelectWallet from "../components/client/WalletHandle/SelectWallet";
import LeakSheet from "../components/LeakSheet";
import Receipt from "../components/Receipt";
import { useFrontendProvider } from "../components/client/provider/providerContext";
import { useStoreWallet } from "../components/Wallet/walletContext";
import { formatUtc } from "@/core/clock";
import { decide } from "@/core/decide";
import { detectHistory, formatAmt } from "@/core/detect";
import { fetchFeeAmount, fetchPublicEdges, fetchPublicStrkBalance } from "@/core/fetch";
import { loadFixture } from "@/core/fixture";
import { rewrite } from "@/core/rewrite";
import type { PlannedKind, PublicEdge, Rewrite, Score } from "@/core/types";
import { fmtToken, parseToken } from "@/lib/format";
import { errorResult, hexAmt, submitStrk20, type ActionResult } from "@/lib/strk20";
import * as constants from "@/utils/constants";
import { sameAddr } from "@/utils/constants";

type Tab = PlannedKind | "balances";

export default function VaultPage() {
  const index = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const network = constants.Strk20Networks[index];
  const account = useStoreWallet((s) => s.myWalletAccount);
  const address = useStoreWallet((s) => s.address);
  const connected = useStoreWallet((s) => s.isConnected);
  const privacyCapable = useStoreWallet((s) => s.privacyCapable);

  const [tab, setTab] = useState<Tab>("shield");
  const [amount, setAmount] = useState("1");
  const [recipient, setRecipient] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [edges, setEdges] = useState<PublicEdge[]>([]);
  const [lookSource, setLookSource] = useState<"live" | "fixture" | "empty">("empty");
  const [lookErr, setLookErr] = useState("");
  const [fee, setFee] = useState<bigint | null>(null);
  const [loadingLook, setLoadingLook] = useState(false);
  const [publicBal, setPublicBal] = useState<bigint | null>(null);

  useEffect(() => {
    let dead = false;
    fetchFeeAmount(index).then((f) => {
      if (!dead) setFee(f);
    });
    if (address) {
      fetchPublicStrkBalance(address, index).then((b) => {
        if (!dead) setPublicBal(b);
      });
    } else {
      setPublicBal(null);
    }
    return () => {
      dead = true;
    };
  }, [index, address]);

  useEffect(() => {
    if (!address) {
      setEdges([]);
      setLookSource("empty");
      return;
    }
    let dead = false;
    setLoadingLook(true);
    setLookErr("");
    fetchPublicEdges(address, index)
      .then((live) => {
        if (dead) return;
        setEdges(live);
        setLookSource(live.length ? "live" : "empty");
      })
      .catch((e: any) => {
        if (dead) return;
        setLookErr(e?.message ?? String(e));
        setEdges(loadFixture());
        setLookSource("fixture");
      })
      .finally(() => {
        if (!dead) setLoadingLook(false);
      });
    return () => {
      dead = true;
    };
  }, [address, index]);

  const historyFindings = useMemo(() => detectHistory(edges), [edges]);

  const plannedKind: PlannedKind = tab === "balances" ? "transfer" : tab;
  const plannedAmt = parseToken(amount);
  const score: Score = useMemo(
    () =>
      decide(edges, {
        kind: plannedKind,
        token: constants.addrSTRK,
        amount: plannedAmt || 1n,
      }),
    [edges, plannedKind, amount]
  );
  const paths: Rewrite[] = useMemo(
    () =>
      rewrite(
        { kind: plannedKind, token: constants.addrSTRK, amount: plannedAmt || 1n },
        score
      ),
    [plannedKind, amount, score]
  );

  function applyRewrite(r: Rewrite) {
    if (r.action?.kind) setTab(r.action.kind);
    if (r.action?.amount != null) setAmount(formatAmt(r.action.amount));
  }

  async function go() {
    setResult(null);
    if (!address) return;
    const amt = parseToken(amount);
    if (tab === "balances") {
      try {
        const raw: any = await account?.strk20Balances([constants.addrSTRK]);
        const arr = Array.isArray(raw) ? raw : raw?.value ?? [];
        if (!arr.length) {
          setResult({
            status: "ok",
            title: "No shielded notes",
            note: "Shield STRK first. That deposit is a public edge.",
          });
          return;
        }
        setResult({
          status: "ok",
          title: "Shielded balances",
          rows: arr.map((b: any) => {
            const token = b?.token ?? b?.token_address ?? b?.[0];
            const bal = b?.amount ?? b?.balance ?? b?.[1];
            const label = sameAddr(String(token), constants.addrSTRK) ? "STRK" : "token";
            try {
              return { label, value: fmtToken(num.toBigInt(bal)) };
            } catch {
              return { label, value: String(bal) };
            }
          }),
        });
      } catch (e: any) {
        setResult(errorResult(e?.message ?? String(e)));
      }
      return;
    }
    const actions: WALLET_API.STRK20_ACTION[] =
      tab === "shield"
        ? [{ type: "deposit", token: constants.addrSTRK, amount: hexAmt(amt) }]
        : tab === "unshield"
          ? [{ type: "withdraw", token: constants.addrSTRK, amount: hexAmt(amt), recipient: address }]
          : [
              {
                type: "transfer",
                token: constants.addrSTRK,
                amount: hexAmt(amt),
                recipient: recipient || address,
              },
            ];
    await submitStrk20({
      account,
      actions,
      networkIndex: index,
      amountLabel: `${amount} STRK`,
      onUpdate: setResult,
    });
  }

  const gradeClass = score.grade === "loud" ? "err" : score.grade === "noisy" ? "pend" : "ok";

  return (
    <div className="page">
      <div className="page-head">
        <p className="kicker">{network ?? "Switch to Mainnet"} · STRK20 pool</p>
        <h1>Vault</h1>
      </div>
      <div className="console">
        <section className="section">
          <p className="kicker">Look back</p>
          <h2 className="section-title">What this address already leaked</h2>
          {loadingLook && <p className="muted">Reading Deposit / Withdrawal events…</p>}
          {lookErr && <p className="warn">Live fetch failed. Showing the offline fixture. {lookErr}</p>}
          {lookSource === "fixture" && !lookErr && <p className="warn">Offline fixture (demo pair).</p>}
          {!address && <p className="muted">Connect Ready to scan your public edges.</p>}
          {address && !loadingLook && (
            <>
              <p className="edge-count">
                {edges.length} public edge{edges.length === 1 ? "" : "s"} · source {lookSource}
              </p>
              <ul className="finding-list">
                {historyFindings.slice(0, 6).map((f) => (
                  <li key={f.id + f.title}>
                    <strong>{f.title}.</strong> {f.detail}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="section">
          <p className="kicker">Look ahead</p>
          <h2 className="section-title">What this next click still reveals</h2>

          <div className="tabs" role="tablist" aria-label="Action">
            {(["shield", "transfer", "unshield", "balances"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className="btn btn-ghost"
                onClick={() => setTab(t)}
              >
                {t === "transfer" ? "send" : t}
              </button>
            ))}
          </div>

          <div className={`receipt ${gradeClass}`}>
            <div className="receipt-head">
              {tab === "balances" ? "Balance read (wallet consent)" : score.grade.toUpperCase()}
            </div>
            {tab !== "balances" &&
              score.quietAfter &&
              score.quietAfter > Math.floor(Date.now() / 1000) && (
                <p className="edge-count">Quiet after {formatUtc(score.quietAfter)}</p>
              )}
            {tab !== "balances" &&
              score.findings.slice(0, 3).map((f) => (
                <p key={f.id} className="muted">
                  {f.detail}
                </p>
              ))}
          </div>

          {tab !== "balances" && <LeakSheet score={score} />}

          <div className="form mt-24">
            {tab !== "balances" && (
              <label>
                <span>Amount (STRK)</span>
                <input className="mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
                {tab === "shield" && publicBal != null && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      const reserve = fee && fee > 0n ? fee : 0n;
                      const max = publicBal > reserve ? publicBal - reserve : 0n;
                      setAmount(formatAmt(max));
                    }}
                  >
                    MAX (public balance minus pool fee)
                  </button>
                )}
              </label>
            )}
            {tab === "transfer" && (
              <label>
                <span>Recipient (defaults to self)</span>
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={address || "0x…"} />
              </label>
            )}
            {fee != null && fee > 0n && tab !== "balances" && (
              <p className="quiet">
                Pool fee (live <code>get_fee_amount</code>): {formatAmt(fee)} STRK per private operation. Reserve it
                when you pick MAX.
              </p>
            )}

            {tab !== "balances" && (
              <div>
                <p className="kicker mb-10">Quieter path</p>
                <div className="stack">
                  {paths.map((p) => (
                    <button key={p.title} type="button" className="btn btn-ghost" onClick={() => applyRewrite(p)}>
                      {p.title}
                    </button>
                  ))}
                </div>
                <p className="quiet mt-20">{paths[0]?.detail}</p>
              </div>
            )}

            {connected && !privacyCapable && (
              <p className="warn">
                This wallet does not advertise Wallet API 0.10. Install{" "}
                <a href="https://www.ready.co/" target="_blank" rel="noreferrer">
                  Ready
                </a>
                .
              </p>
            )}
            {tab === "shield" && privacyCapable && (
              <p className="warn">
                Shield is two wallet prompts: public approve, then deposit. A screening decline is the pool, not a
                duplicate bug.
              </p>
            )}
            {connected ? (
              <button className="btn btn-primary" disabled={!network || !privacyCapable} onClick={go}>
                {tab === "balances"
                  ? "Read notes"
                  : tab === "shield"
                    ? "Approve, then shield"
                    : tab === "transfer"
                      ? "Send privately"
                      : "Unshield"}
              </button>
            ) : (
              <SelectWallet />
            )}
          </div>
        </section>

        {result ? <Receipt r={result} networkIndex={index} /> : null}
      </div>
    </div>
  );
}
