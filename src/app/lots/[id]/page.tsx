"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { num } from "starknet";
import SelectWallet from "../../components/client/WalletHandle/SelectWallet";
import LeakSheet from "../../components/LeakSheet";
import Receipt from "../../components/Receipt";
import { useFrontendProvider } from "../../components/client/provider/providerContext";
import { useStoreWallet } from "../../components/Wallet/walletContext";
import { readAuction, readBid, type AuctionView, type BidView } from "@/lib/auction";
import { computeCommitment, randomSalt, saveSecret, secretsFor } from "@/lib/commitment";
import { fmtCountdown, fmtToken, phaseOf } from "@/lib/format";
import { invokeActions, submitStrk20, tenderCalldata, type ActionResult } from "@/lib/strk20";
import * as constants from "@/utils/constants";

const HELPER_LS = "tender.helper.";

function helperAddress(index: number): string {
  const env = constants.tenderHelperForIndex(index);
  if (typeof window !== "undefined") {
    return localStorage.getItem(HELPER_LS + index) || env;
  }
  return env;
}

export default function LotPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const index = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const account = useStoreWallet((s) => s.myWalletAccount);
  const address = useStoreWallet((s) => s.address);
  const connected = useStoreWallet((s) => s.isConnected);

  const helper = useMemo(() => helperAddress(index), [index]);
  const [lot, setLot] = useState<AuctionView | null>(null);
  const [bids, setBids] = useState<BidView[]>([]);
  const [bidAmt, setBidAmt] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    if (!helper || helper === "0x0" || !id) return;
    const a = await readAuction(index, helper, id);
    setLot(a);
    if (!a) return;
    const rows: BidView[] = [];
    for (let i = 1; i <= a.bidCount; i++) {
      rows.push(await readBid(index, helper, id, i));
    }
    setBids(rows);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [helper, id, index, tick]);

  const now = Math.floor(Date.now() / 1000);
  const phase = lot ? phaseOf(now, lot.bidEnd, lot.revealEnd, lot.settled) : "bidding";
  const secrets = typeof window !== "undefined" ? secretsFor(id) : [];

  async function run(actions: any, label: string) {
    await submitStrk20({ account, actions, networkIndex: index, amountLabel: label, onUpdate: setResult });
    setTimeout(() => refresh().catch(() => undefined), 4000);
  }

  async function placeBid() {
    if (!lot || !address) return;
    const amount = BigInt(Math.round(Number(bidAmt) * 1e18));
    if (amount < lot.minBid || amount > lot.maxBid) {
      setResult({ status: "error", title: "Bid out of range", note: "Stay between reserve and max bid." });
      return;
    }
    const salt = randomSalt();
    const commitment = computeCommitment(amount, salt);
    const nextId = lot.bidCount + 1;
    saveSecret({
      auctionId: id,
      bidId: nextId,
      amount: amount.toString(),
      salt,
      commitment,
    });
    const calldata = tenderCalldata({
      operation: constants.OP.BID,
      auctionId: id,
      commitment,
    });
    await run(
      invokeActions({
        helper,
        token: lot.bidToken,
        amount: lot.maxBid,
        recipient: address,
        calldata,
        withdraw: true,
      }),
      `deposit ${fmtToken(lot.maxBid)} STRK`
    );
  }

  async function reveal(secret: { bidId: number; amount: string; salt: string }) {
    if (!lot || !address) return;
    const calldata = tenderCalldata({
      operation: constants.OP.REVEAL,
      auctionId: id,
      bidId: secret.bidId,
      revealAmount: BigInt(secret.amount),
      revealSalt: secret.salt,
    });
    await run(
      invokeActions({
        helper,
        token: lot.bidToken,
        amount: 0n,
        recipient: address,
        calldata,
        withdraw: false,
      }),
      `reveal bid ${secret.bidId}`
    );
  }

  async function settle() {
    const provider = constants.myFrontendProviders[index];
    const acc: any = account;
    if (!acc?.execute && !acc?.executeFromOutside) {
      setResult({ status: "error", title: "Connect a wallet to settle." });
      return;
    }
    try {
      setResult({ status: "pending", title: "Settling…" });
      const tx = await acc.execute({
        contractAddress: helper,
        entrypoint: "settle",
        calldata: [num.toHex(id)],
      });
      const hash = tx.transaction_hash;
      await provider.waitForTransaction(hash, { retries: 200, retryInterval: 3000 });
      setResult({
        status: "ok",
        title: "Settled",
        rows: [{ label: "Transaction", value: hash.slice(0, 10) + "…", hash }],
      });
      refresh().catch(() => undefined);
    } catch (e: any) {
      setResult({ status: "error", title: "Settle failed", note: e?.message ?? String(e) });
    }
  }

  async function claim(op: number, label: string, bidId = 0) {
    if (!lot || !address) return;
    const calldata = tenderCalldata({ operation: op, auctionId: id, bidId });
    await run(
      invokeActions({
        helper,
        token: lot.lotToken,
        amount: 0n,
        recipient: address,
        calldata,
        withdraw: false,
      }),
      label
    );
  }

  if (!lot) {
    return (
      <div className="page">
        <p className="eyebrow">Lot {id}</p>
        <h1 className="empty">This lot is not on the helper yet.</h1>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            Lot {lot.id} · {lot.kind === 1 ? "Vickrey" : "First price"}
          </p>
          <h1>{fmtToken(lot.lotAmount)} STRK</h1>
        </div>
        <span className={`pill ${phase === "bidding" ? "pill-live" : ""}`}>{phase}</span>
      </div>

      <div className="detail">
        <div>
          <div className="kv">
            <div className="kv-row">
              <span>Reserve</span>
              <span>{fmtToken(lot.minBid)} STRK</span>
            </div>
            <div className="kv-row">
              <span>Uniform deposit</span>
              <span>{fmtToken(lot.maxBid)} STRK</span>
            </div>
            <div className="kv-row">
              <span>Bids</span>
              <span>{lot.bidCount} / 32</span>
            </div>
            <div className="kv-row">
              <span>Bidding ends</span>
              <span>{phase === "bidding" ? fmtCountdown(lot.bidEnd - now) : "closed"}</span>
            </div>
            <div className="kv-row">
              <span>Reveal ends</span>
              <span>{phase === "reveal" ? fmtCountdown(lot.revealEnd - now) : phase === "bidding" ? "after bidding" : "closed"}</span>
            </div>
            {lot.settled && (
              <>
                <div className="kv-row">
                  <span>Winner bid</span>
                  <span>{lot.winnerBidId || "none"}</span>
                </div>
                <div className="kv-row">
                  <span>Clearing price</span>
                  <span>{fmtToken(lot.winningPrice)} STRK</span>
                </div>
              </>
            )}
          </div>

          <h3 style={{ fontFamily: "var(--font-serif)", fontSize: 28, fontWeight: 500, margin: "28px 0 12px" }}>
            Bids
          </h3>
          {bids.length === 0 && <p style={{ color: "var(--text-3)" }}>No deposits yet.</p>}
          {bids.map((b) => (
            <div key={b.id} className="kv-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span>#{b.id}</span>
              <span className="num">
                {b.revealed ? `${fmtToken(b.amount)} STRK` : "sealed"}
                {b.refundClaimed ? " · refunded" : ""}
              </span>
            </div>
          ))}
        </div>

        <div className="panel">
          {!connected && <SelectWallet />}

          {connected && phase === "bidding" && (
            <>
              <p className="eyebrow">Place a sealed bid</p>
              <p style={{ color: "var(--text-2)", fontSize: 14, margin: "10px 0 16px", lineHeight: 1.5 }}>
                You lock {fmtToken(lot.maxBid)} STRK. Only the number below is committed.
                Keep this browser — the salt is saved locally so you can reveal.
              </p>
              <label>
                <span>Your bid (STRK)</span>
                <input className="num" value={bidAmt} onChange={(e) => setBidAmt(e.target.value)} placeholder="true value" />
              </label>
              <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={placeBid}>
                Deposit and seal
              </button>
            </>
          )}

          {connected && phase === "reveal" && (
            <>
              <p className="eyebrow">Reveal</p>
              {secrets.length === 0 && (
                <p style={{ color: "var(--text-2)", fontSize: 14, marginTop: 10 }}>
                  No local salt for this lot. Import a secret from the protocol page if you bid on another machine.
                </p>
              )}
              {secrets.map((s) => (
                <button
                  key={s.bidId}
                  className="btn btn-primary btn-block"
                  style={{ marginTop: 12 }}
                  onClick={() => reveal(s)}
                >
                  Reveal bid {s.bidId} · {fmtToken(BigInt(s.amount))} STRK
                </button>
              ))}
            </>
          )}

          {connected && phase === "settle" && (
            <button className="btn btn-primary btn-block" onClick={settle}>
              Settle this lot
            </button>
          )}

          {connected && phase === "settled" && (
            <div style={{ display: "grid", gap: 10 }}>
              <button className="btn btn-primary" onClick={() => claim(constants.OP.CLAIM_WIN, "claim lot")}>
                Claim lot
              </button>
              <button className="btn btn-ghost" onClick={() => claim(constants.OP.CLAIM_PROCEEDS, "claim proceeds")}>
                Claim proceeds
              </button>
              <button className="btn btn-ghost" onClick={() => claim(constants.OP.CLAIM_UNSOLD, "reclaim unsold lot")}>
                Reclaim unsold lot
              </button>
              {secrets.map((s) => (
                <button
                  key={s.bidId}
                  className="btn btn-ghost"
                  onClick={() => claim(constants.OP.CLAIM_REFUND, `refund bid ${s.bidId}`, s.bidId)}
                >
                  Refund bid {s.bidId}
                </button>
              ))}
            </div>
          )}

          {result ? <Receipt r={result} networkIndex={index} /> : null}
        </div>
      </div>

      <LeakSheet kind={phase === "bidding" ? "bid" : phase === "reveal" ? "reveal" : phase === "settle" ? "settle" : "claim"} />
    </div>
  );
}
