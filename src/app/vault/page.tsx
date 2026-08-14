"use client";

import { useState } from "react";
import { num } from "starknet";
import type { WALLET_API } from "@starknet-io/types-js";
import SelectWallet from "../components/client/WalletHandle/SelectWallet";
import LeakSheet from "../components/LeakSheet";
import Receipt from "../components/Receipt";
import { useFrontendProvider } from "../components/client/provider/providerContext";
import { useStoreWallet } from "../components/Wallet/walletContext";
import { fmtToken, parseToken } from "@/lib/format";
import { errorResult, hexAmt, submitStrk20, type ActionResult } from "@/lib/strk20";
import * as constants from "@/utils/constants";

type Tab = "shield" | "send" | "unshield" | "balances";

export default function VaultPage() {
  const index = useFrontendProvider((s) => s.currentFrontendProviderIndex);
  const network = constants.Strk20Networks[index];
  const account = useStoreWallet((s) => s.myWalletAccount);
  const address = useStoreWallet((s) => s.address);
  const connected = useStoreWallet((s) => s.isConnected);

  const [tab, setTab] = useState<Tab>("shield");
  const [amount, setAmount] = useState("1");
  const [recipient, setRecipient] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);

  async function go() {
    setResult(null);
    if (!address) return;
    const amt = parseToken(amount);
    if (tab === "balances") {
      try {
        const raw: any = await account?.strk20Balances([]);
        const arr = Array.isArray(raw) ? raw : raw?.value ?? [];
        if (!arr.length) {
          setResult({ status: "ok", title: "No shielded notes", note: "Shield STRK before you list or bid." });
          return;
        }
        setResult({
          status: "ok",
          title: "Shielded balances",
          rows: arr.map((b: any) => {
            const token = b?.token ?? b?.token_address ?? b?.[0];
            const bal = b?.amount ?? b?.balance ?? b?.[1];
            const label =
              (() => {
                try {
                  return num.toBigInt(token) === num.toBigInt(constants.addrSTRK) ? "STRK" : String(token).slice(0, 10);
                } catch {
                  return "token";
                }
              })();
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{network ?? "Switch to Mainnet or Sepolia"} · STRK20 pool</p>
          <h1>Vault</h1>
        </div>
      </div>

      <p style={{ color: "var(--text-2)", maxWidth: 560, marginBottom: 28, lineHeight: 1.55 }}>
        The vault is the public edge of the pool. Deposits and withdrawals show
        an address and an amount. Transfers inside the pool do not. Auction
        actions spend these notes.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {(["shield", "send", "unshield", "balances"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`btn ${tab === t ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="form">
        {tab !== "balances" && (
          <label>
            <span>Amount (STRK)</span>
            <input className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        )}
        {tab === "send" && (
          <label>
            <span>Recipient (defaults to self)</span>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={address || "0x…"} />
          </label>
        )}
        {connected ? (
          <button className="btn btn-primary" disabled={!network} onClick={go}>
            {tab === "balances" ? "Read notes" : tab}
          </button>
        ) : (
          <SelectWallet />
        )}
      </div>

      {result ? <Receipt r={result} networkIndex={index} /> : null}
      <LeakSheet kind={tab === "send" ? "transfer" : tab === "balances" ? "transfer" : tab} />
    </div>
  );
}
