"use client";

import { useEffect, useState } from "react";
import { walletV6 } from "starknet";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import {
  StarknetWalletApi,
  type WalletWithStarknetFeatures,
} from "@starknet-io/get-starknet-wallet-standard/features";
import { classify, message } from "../probe/classify";
import { NETWORKS, providerFor } from "@/utils/networks";
import { poolReader } from "@/core/read";
import { formatAmount } from "@/core/view";

/**
 * The Ready side of the demo, for development only.
 *
 * Ready owns its viewing key and its private state. This page never tries to
 * derive, hold or reconstruct any of it, and never builds a proof: every write
 * goes through `wallet_strk20InvokeTransaction`, which makes the wallet do the
 * proving with its own proving service. There is deliberately no Lens prover
 * path here.
 *
 * There is also deliberately no REGISTER button. Wallet API 0.10.3 defines
 * exactly three STRK20 methods and none of them registers a user, so a register
 * button would be a lie about what the API can do. When the wallet reports
 * NOT_REGISTERED this page says so and points at the official app.
 *
 * Nothing is submitted on load. Each write needs the exact confirmation phrase
 * typed, then a click, then Ready's own approval.
 */

const NET = NETWORKS.mainnet;
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const LENS = "0x47366fff6d7da5f313cf6a379f460c8544db248231a532e533afd588d801aca";
const DECIMALS = 18;

/** Values from docs/READY_ROUTE.md. Kept small and round on purpose. */
const DEPOSIT_STRK = 4n;
const TRANSFER_STRK = 15n; // tenths, so 1.5 STRK
const CONFIRM = "I understand this spends real STRK";

const toWei = (whole: bigint) => whole * 10n ** BigInt(DECIMALS);
const toWeiTenths = (tenths: bigint) => (tenths * 10n ** BigInt(DECIMALS)) / 10n;

type Registration = "unknown" | "registered" | "not registered" | "unreadable";

export default function ReadyClient() {
  const [wallets, setWallets] = useState<readonly WalletWithStarknetFeatures[]>([]);
  const [wallet, setWallet] = useState<WalletWithStarknetFeatures | null>(null);
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState("");
  const [busy, setBusy] = useState(false);
  const [publicStrk, setPublicStrk] = useState<string>("reading…");
  const [privateStrk, setPrivateStrk] = useState<string>("reading…");
  const [registration, setRegistration] = useState<Registration>("unknown");
  const [poolKey, setPoolKey] = useState<string>("");
  const [confirm, setConfirm] = useState("");
  const [log, setLog] = useState<string[]>([]);

  const say = (s: string) => setLog((l) => [...l, s]);

  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding from an external store on mount
    setWallets(store.getWallets().slice());
    const unsub = store.subscribe((next) => setWallets(next.slice()));
    return () => unsub();
  }, []);

  function api(w: WalletWithStarknetFeatures) {
    const feature = w.features[StarknetWalletApi];
    if (!feature || typeof feature.request !== "function") {
      throw new Error(`This wallet announces no usable "${StarknetWalletApi}" feature.`);
    }
    return feature;
  }

  async function connect(w: WalletWithStarknetFeatures) {
    setBusy(true);
    try {
      const accounts = (await walletV6.requestAccounts(w as never)) as string[];
      const chain = (await walletV6.requestChainId(w as never)) as string;
      setWallet(w);
      setAddress(accounts?.[0] ?? "");
      setChainId(chain);
      await refresh(w, accounts?.[0] ?? "");
    } catch (e) {
      say(`connect: ${message(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function refresh(w: WalletWithStarknetFeatures, who: string) {
    // Public balance and pool registration come from the chain, not the wallet,
    // so they are true even if the wallet is being unhelpful.
    const provider = providerFor(NET);
    try {
      const r = await provider.callContract({
        contractAddress: STRK,
        entrypoint: "balanceOf",
        calldata: [who],
      });
      setPublicStrk(formatAmount(BigInt(r[0]) + (BigInt(r[1] ?? "0x0") << 128n), DECIMALS));
    } catch (e) {
      setPublicStrk(`unreadable: ${message(e)}`);
    }

    try {
      const key = await poolReader(provider, NET.pool).getPublicKey(who);
      setPoolKey(key === 0n ? "none" : `0x${key.toString(16)}`);
      setRegistration(key === 0n ? "not registered" : "registered");
    } catch (e) {
      setRegistration("unreadable");
      say(`get_public_key: ${message(e)}`);
    }

    try {
      const balances = (await api(w).request({
        type: "wallet_strk20Balances",
        params: { tokens: [STRK] },
      })) as Array<{ token: string; balance: string }>;
      const entry = balances?.find((b) => BigInt(b.token) === BigInt(STRK));
      setPrivateStrk(entry ? formatAmount(BigInt(entry.balance), DECIMALS) : "0");
    } catch (e) {
      const c = classify(e);
      setPrivateStrk(c.verdict === "SUPPORTED" ? "not registered yet" : `unavailable: ${c.detail}`);
    }
  }

  /**
   * The only write path on this page. It hands the wallet a description of the
   * actions and lets the wallet prove and submit them. The dapp never sees a
   * viewing key, never builds a proof and never signs anything.
   */
  async function invoke(label: string, actions: unknown[]) {
    if (!wallet) return;
    if (confirm.trim() !== CONFIRM) {
      say(`${label}: refused, the confirmation phrase does not match.`);
      return;
    }
    if (BigInt(chainId || "0x0") !== BigInt(NET.chainId)) {
      say(`${label}: refused, the wallet is not on ${NET.label}.`);
      return;
    }
    setBusy(true);
    say(`${label}: sending to the wallet. Approve or reject it in Ready.`);
    try {
      const result = (await api(wallet).request({
        type: "wallet_strk20InvokeTransaction",
        params: { actions: actions as never },
      })) as { transaction_hash: string };
      say(`${label}: submitted ${result.transaction_hash}`);
      say(`  ${NET.explorer}/tx/${result.transaction_hash}`);
      setConfirm("");
      await refresh(wallet, address);
    } catch (e) {
      say(`${label}: ${message(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const armed = confirm.trim() === CONFIRM && !busy && registration === "registered";
  const cell: React.CSSProperties = { padding: "0.3rem 1rem 0.3rem 0", color: "#777", whiteSpace: "nowrap", verticalAlign: "top" };
  const btn: React.CSSProperties = { font: "inherit", padding: "0.6rem 1rem", cursor: "pointer" };

  return (
    <main style={{ maxWidth: "46rem", margin: "3rem auto", padding: "0 1.5rem", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.4rem", letterSpacing: "-0.01em" }}>Ready execution, development only</h1>
      <p style={{ color: "#666" }}>
        This page can spend real STRK on Starknet mainnet. Nothing is sent on load. Every write
        needs the confirmation phrase typed, a click, and then your own approval inside Ready.
        Ready keeps its viewing key and does its own proving; this page never sees either.
      </p>

      {!wallet && (
        <section style={{ marginTop: "2rem", display: "grid", gap: "0.6rem" }}>
          {wallets.length === 0 ? (
            <p>No Starknet wallet announced itself yet. Reload once with the extension unlocked.</p>
          ) : (
            wallets.map((w) => (
              <button key={w.name} type="button" style={{ ...btn, textAlign: "left" }} disabled={busy} onClick={() => connect(w)}>
                {busy ? "Connecting…" : `Connect ${w.name}`}
              </button>
            ))
          )}
        </section>
      )}

      {wallet && (
        <section style={{ marginTop: "2rem" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {[
                ["Wallet", wallet.name],
                ["Address", address],
                ["Network", `${chainId} ${BigInt(chainId || "0x0") === BigInt(NET.chainId) ? "" : "  NOT MAINNET"}`],
                ["Pool registration", registration],
                ["Registered public key", poolKey || "not read"],
                ["Public STRK", publicStrk],
                ["Private STRK", privateStrk],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={cell}>{k}</td>
                  <td style={{ padding: "0.3rem 0", wordBreak: "break-all" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {registration !== "registered" && (
            <div style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid #ccc" }}>
              <strong>This account is not registered with the pool.</strong>
              <p style={{ margin: "0.5rem 0 0", color: "#666" }}>
                Wallet API 0.10.3 has no registration method, so no dapp can register you, and
                there is deliberately no button here that pretends otherwise. Register once at{" "}
                <a href="https://strk20.starknet.io/app" target="_blank" rel="noreferrer noopener">
                  strk20.starknet.io/app
                </a>
                , then reload this page. The actions below stay disabled until then.
              </p>
            </div>
          )}

          <div style={{ marginTop: "2rem" }}>
            <label style={{ display: "block", marginBottom: "0.4rem" }}>
              To arm the actions, type: <code>{CONFIRM}</code>
            </label>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={{ font: "inherit", padding: "0.5rem", width: "100%", boxSizing: "border-box" }}
              placeholder="confirmation phrase"
            />
          </div>

          <div style={{ marginTop: "1.5rem", display: "grid", gap: "0.8rem" }}>
            <button
              type="button"
              style={btn}
              disabled={!armed}
              onClick={() =>
                invoke("Shield", [{ type: "deposit", token: STRK, amount: `0x${toWei(DEPOSIT_STRK).toString(16)}` }])
              }
            >
              Shield {DEPOSIT_STRK.toString()} STRK into the pool
            </button>

            <button
              type="button"
              style={btn}
              disabled={!armed}
              onClick={() =>
                invoke("Transfer A", [
                  { type: "transfer", token: STRK, amount: `0x${toWeiTenths(TRANSFER_STRK).toString(16)}`, recipient: LENS },
                ])
              }
            >
              Private transfer 1.5 STRK to the Lens account
            </button>

            <button
              type="button"
              style={btn}
              disabled={!armed}
              onClick={() =>
                invoke("Transfer B", [
                  { type: "transfer", token: STRK, amount: `0x${toWeiTenths(TRANSFER_STRK).toString(16)}`, recipient: LENS },
                ])
              }
            >
              Private transfer 1.5 STRK to the Lens account, again
            </button>
          </div>

          <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#777" }}>
            The transfers will fail until the Lens account is registered, because a private
            transfer needs the recipient&apos;s public viewing key to exist. Recipient:{" "}
            <code style={{ wordBreak: "break-all" }}>{LENS}</code>
          </p>

          <button type="button" style={{ ...btn, marginTop: "1.5rem" }} disabled={busy} onClick={() => refresh(wallet, address)}>
            Re-read state
          </button>

          {log.length > 0 && (
            <pre style={{ marginTop: "1.6rem", fontSize: "0.8rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {log.join("\n")}
            </pre>
          )}
        </section>
      )}
    </main>
  );
}
