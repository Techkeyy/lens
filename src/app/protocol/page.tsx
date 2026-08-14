"use client";

import { useEffect, useState } from "react";
import { validateAndParseAddress } from "starknet";
import { useFrontendProvider } from "../components/client/provider/providerContext";
import { useStoreWallet } from "../components/Wallet/walletContext";
import { exportSecrets, importSecrets } from "@/lib/commitment";
import * as constants from "@/utils/constants";
import LeakSheet from "../components/LeakSheet";

const HELPER_LS = "tender.helper.";

export default function ProtocolPage() {
  const index = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const network = constants.Strk20Networks[index] ?? "—";
  const account = useStoreWallet((s) => s.myWalletAccount);
  const [helper, setHelper] = useState("0x0");
  const [draft, setDraft] = useState("");
  const [secrets, setSecrets] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(HELPER_LS + index) || constants.tenderHelperForIndex(index);
    setHelper(saved);
    setDraft(saved === "0x0" ? "" : saved);
    setSecrets(exportSecrets());
  }, [index]);

  function saveHelper() {
    try {
      const addr = validateAndParseAddress(draft);
      localStorage.setItem(HELPER_LS + index, addr);
      setHelper(addr);
      setNote(`Saved helper for ${network}.`);
    } catch (e: any) {
      setNote(e?.message ?? "Invalid address");
    }
  }

  async function deploy() {
    const classHash = constants.TenderHelperClassHash;
    if (!account) {
      setNote("Connect a wallet first.");
      return;
    }
    if (!classHash || classHash === "0x0") {
      setNote("Declare cairo/src/lib.cairo first, then set NEXT_PUBLIC_TENDER_CLASS_HASH.");
      return;
    }
    try {
      const { transaction_hash, contract_address } = await account.deployContract({
        classHash,
        constructorCalldata: [],
      });
      const addr = validateAndParseAddress(contract_address);
      localStorage.setItem(HELPER_LS + index, addr);
      setHelper(addr);
      setDraft(addr);
      setNote(`Deployed ${addr}. Tx ${transaction_hash}`);
    } catch (e: any) {
      setNote(e?.message ?? String(e));
    }
  }

  function doImport() {
    try {
      const n = importSecrets(secrets);
      setNote(`Imported ${n} new bid secret(s).`);
    } catch (e: any) {
      setNote(e?.message ?? "Could not import");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Honest accounting</p>
          <h1>Protocol</h1>
        </div>
      </div>

      <p style={{ color: "var(--text-2)", maxWidth: 640, lineHeight: 1.6, marginBottom: 36 }}>
        Tender is a private dapp on the Wallet API plus one anonymizer. It does
        not use viewing keys, sub-accounts (Wallet API still pending), or a
        custom prover. Deposit screening still applies to every shield.
      </p>

      <div className="grid-3" style={{ marginTop: 0, marginBottom: 48 }}>
        <article className="card">
          <p className="eyebrow">Helper</p>
          <h3>{helper === "0x0" ? "Not set" : helper.slice(0, 10) + "…"}</h3>
          <p>{network}</p>
        </article>
        <article className="card">
          <p className="eyebrow">Pool</p>
          <h3>STRK20 live</h3>
          <p>Mainnet and Sepolia. Wallet substitutes ${"{poolAddress}"}.</p>
        </article>
        <article className="card">
          <p className="eyebrow">Cap</p>
          <h3>32 bids</h3>
          <p>Settle walks the list on-chain. Keep lots small on purpose.</p>
        </article>
      </div>

      <div className="form" style={{ marginBottom: 48 }}>
        <label>
          <span>Helper address on {network}</span>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="0x…" />
        </label>
        <div className="two">
          <button className="btn btn-primary" onClick={saveHelper}>
            Save address
          </button>
          <button className="btn btn-ghost" onClick={deploy}>
            Deploy declared class
          </button>
        </div>
        {note ? <p className="warn">{note}</p> : null}
      </div>

      <h2 style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 40, marginBottom: 12 }}>
        Bid secrets
      </h2>
      <p style={{ color: "var(--text-2)", maxWidth: 560, lineHeight: 1.55, marginBottom: 16 }}>
        The salt lives in this browser. Export it if you will reveal from another
        machine. Anyone with the salt can open that bid.
      </p>
      <textarea value={secrets} onChange={(e) => setSecrets(e.target.value)} />
      <div className="two" style={{ marginTop: 12, maxWidth: 560 }}>
        <button className="btn btn-ghost" onClick={() => setSecrets(exportSecrets())}>
          Refresh export
        </button>
        <button className="btn btn-ghost" onClick={doImport}>
          Import
        </button>
      </div>

      <div style={{ marginTop: 64 }}>
        <h2 style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 40, marginBottom: 8 }}>
          Leak sheets
        </h2>
        <LeakSheet kind="list" />
        <LeakSheet kind="bid" />
        <LeakSheet kind="reveal" />
        <LeakSheet kind="settle" />
        <LeakSheet kind="claim" />
        <LeakSheet kind="shield" />
        <LeakSheet kind="transfer" />
        <LeakSheet kind="unshield" />
      </div>
    </div>
  );
}
