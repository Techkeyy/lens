"use client";

import { useMemo, useState } from "react";
import SelectWallet from "../components/client/WalletHandle/SelectWallet";
import LeakSheet from "../components/LeakSheet";
import Receipt from "../components/Receipt";
import { useFrontendProvider } from "../components/client/provider/providerContext";
import { useStoreWallet } from "../components/Wallet/walletContext";
import { invokeActions, submitStrk20, tenderCalldata, type ActionResult } from "@/lib/strk20";
import { parseToken } from "@/lib/format";
import * as constants from "@/utils/constants";

const HELPER_LS = "tender.helper.";

export default function NewLotPage() {
  const index = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const account = useStoreWallet((s) => s.myWalletAccount);
  const address = useStoreWallet((s) => s.address);
  const connected = useStoreWallet((s) => s.isConnected);

  const helper = useMemo(() => {
    const env = constants.tenderHelperForIndex(index);
    if (typeof window !== "undefined") {
      return localStorage.getItem(HELPER_LS + index) || env;
    }
    return env;
  }, [index]);

  const [lotAmt, setLotAmt] = useState("1");
  const [maxBid, setMaxBid] = useState("5");
  const [minBid, setMinBid] = useState("1");
  const [bidHours, setBidHours] = useState("6");
  const [revealHours, setRevealHours] = useState("6");
  const [kind, setKind] = useState("1");
  const [result, setResult] = useState<ActionResult | null>(null);

  const deployed = helper && helper !== "0x0";

  async function list() {
    if (!address) return;
    const now = Math.floor(Date.now() / 1000);
    const bidEnd = now + Math.max(1, Number(bidHours)) * 3600;
    const revealEnd = bidEnd + Math.max(1, Number(revealHours)) * 3600;
    const lotAmount = parseToken(lotAmt);
    const calldata = tenderCalldata({
      operation: constants.OP.LIST,
      lotToken: constants.addrSTRK,
      lotAmount,
      bidToken: constants.addrSTRK,
      maxBid: parseToken(maxBid),
      minBid: parseToken(minBid),
      bidEnd,
      revealEnd,
      kind: Number(kind),
    });
    const actions = invokeActions({
      helper,
      token: constants.addrSTRK,
      amount: lotAmount,
      recipient: address,
      calldata,
      withdraw: true,
    });
    await submitStrk20({
      account,
      actions,
      networkIndex: index,
      amountLabel: `${lotAmt} STRK lot`,
      onUpdate: setResult,
    });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Create</p>
          <h1>List a lot</h1>
        </div>
      </div>

      <p style={{ color: "var(--text-2)", maxWidth: 560, marginBottom: 28, lineHeight: 1.55 }}>
        The lot is withdrawn from your shielded STRK into the helper. Your
        address does not appear as the seller. Use a uniform max bid large enough
        for the room — every bidder will lock that amount.
      </p>

      {!deployed && (
        <p className="warn" style={{ marginBottom: 20 }}>
          Helper address missing. Deploy the Cairo contract and save it on the
          protocol page before listing.
        </p>
      )}

      <div className="form">
        <label>
          <span>Lot size (STRK)</span>
          <input className="num" value={lotAmt} onChange={(e) => setLotAmt(e.target.value)} />
        </label>
        <div className="two">
          <label>
            <span>Reserve / min bid</span>
            <input className="num" value={minBid} onChange={(e) => setMinBid(e.target.value)} />
          </label>
          <label>
            <span>Max bid (uniform deposit)</span>
            <input className="num" value={maxBid} onChange={(e) => setMaxBid(e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label>
            <span>Bidding window (hours)</span>
            <input className="num" value={bidHours} onChange={(e) => setBidHours(e.target.value)} />
          </label>
          <label>
            <span>Reveal window (hours)</span>
            <input className="num" value={revealHours} onChange={(e) => setRevealHours(e.target.value)} />
          </label>
        </div>
        <label>
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="1">Vickrey — winner pays second price</option>
            <option value="0">First price — winner pays their bid</option>
          </select>
        </label>

        {connected ? (
          <button className="btn btn-primary" disabled={!deployed} onClick={list}>
            List from shielded STRK
          </button>
        ) : (
          <SelectWallet />
        )}
      </div>

      {result ? <Receipt r={result} networkIndex={index} /> : null}
      <LeakSheet kind="list" />
    </div>
  );
}
