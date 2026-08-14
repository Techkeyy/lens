"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { num } from "starknet";
import { useFrontendProvider } from "../components/client/provider/providerContext";
import { readBoard, type AuctionView } from "@/lib/auction";
import { fmtCountdown, fmtToken } from "@/lib/format";
import * as constants from "@/utils/constants";

const HELPER_LS = "tender.helper.";

function helperAddress(index: number): string {
  const env = constants.tenderHelperForIndex(index);
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem(HELPER_LS + index);
    if (saved && saved !== "0x0") return saved;
  }
  return env;
}

function tokenLabel(addr: string) {
  try {
    if (num.toBigInt(addr) === num.toBigInt(constants.addrSTRK)) return "STRK";
    if (num.toBigInt(addr) === num.toBigInt(constants.addrUSDC)) return "USDC";
  } catch {
    /* */
  }
  return "token";
}

function phaseLabel(p: AuctionView["phase"]) {
  if (p === "bidding") return "Bidding";
  if (p === "reveal") return "Reveal";
  if (p === "settle") return "Needs settle";
  return "Settled";
}

export default function LotsPage() {
  const index = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const network = constants.Strk20Networks[index] ?? "Unsupported";
  const [helper, setHelper] = useState("0x0");
  const [lots, setLots] = useState<AuctionView[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const now = Math.floor(Date.now() / 1000);

  useEffect(() => {
    const h = helperAddress(index);
    setHelper(h);
    let dead = false;
    async function load() {
      if (!h || h === "0x0") {
        setLots([]);
        return;
      }
      setLoading(true);
      setErr("");
      try {
        const board = await readBoard(index, h);
        if (!dead) setLots(board);
      } catch (e: any) {
        if (!dead) setErr(e?.message ?? "Could not read the helper.");
      } finally {
        if (!dead) setLoading(false);
      }
    }
    load();
    return () => {
      dead = true;
    };
  }, [index]);

  const deployed = helper && helper !== "0x0";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{network} · live board</p>
          <h1>Lots</h1>
        </div>
        <Link href="/new" className="btn btn-primary">
          List a lot
        </Link>
      </div>

      {!deployed && (
        <p className="warn" style={{ marginBottom: 24 }}>
          The Tender helper is not configured on {network}. Shield and transfer
          still work in the vault. To list, deploy{" "}
          <code>cairo/src/lib.cairo</code> and paste the address on the protocol
          page.
        </p>
      )}

      {loading && <p className="empty">Reading the helper…</p>}
      {err && <p className="warn">{err}</p>}
      {deployed && !loading && lots.length === 0 && (
        <p className="empty">No lots yet. The board is empty on purpose.</p>
      )}

      <div className="lots">
        {lots.map((lot) => (
          <Link key={lot.id} href={`/lots/${lot.id}`} className="lot">
            <div>
              <h3>Lot {lot.id}</h3>
              <div className="meta num">
                {fmtToken(lot.lotAmount)} {tokenLabel(lot.lotToken)} · reserve{" "}
                {fmtToken(lot.minBid)} {tokenLabel(lot.bidToken)} ·{" "}
                {lot.kind === 1 ? "Vickrey" : "First price"}
              </div>
            </div>
            <span className={`pill ${lot.phase === "bidding" ? "pill-live" : lot.phase === "settled" ? "pill-ok" : ""}`}>
              {phaseLabel(lot.phase)}
            </span>
            <span className="num" style={{ color: "var(--text-2)" }}>
              {lot.phase === "bidding"
                ? fmtCountdown(lot.bidEnd - now)
                : lot.phase === "reveal"
                  ? fmtCountdown(lot.revealEnd - now)
                  : `${lot.bidCount} bids`}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
