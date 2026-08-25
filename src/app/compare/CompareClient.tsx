"use client";

import { useEffect, useState } from "react";
import { walletV6 } from "starknet";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import {
  StarknetWalletApi,
  type WalletWithStarknetFeatures,
} from "@starknet-io/get-starknet-wallet-standard/features";
import { message } from "../probe/classify";
import {
  publicViewingKey,
  viewingKeyFromWalletSignature,
  viewingKeyTypedData,
} from "@/core/session";
import { NETWORKS, providerFor } from "@/utils/networks";
import { poolReader } from "@/core/read";

/**
 * Does Lens derive the same viewing key the wallet registered?
 *
 * The sprint's own MAINNET-DAY-0 publishes a "canonical derivation" that signs
 * `${chainId}:${poolAddress}`, folds the signature with Poseidon and reduces
 * into the curve order. That is the construction Lens uses. If the wallet uses
 * it too, then the key Lens derives from a wallet signature is the key the
 * wallet registered, and Lens could read a wallet-registered relationship with
 * no separate Lens-controlled registration at all.
 *
 * This page answers that with two public values and nothing else:
 *
 *   pool.get_public_key(address)      what the wallet actually registered
 *   publicViewingKey(derived)         the public half of what Lens derives
 *
 * The private half never leaves this function. It is not rendered, not logged,
 * not stored, and not put in React state. Only the public halves are compared,
 * and only the public halves are shown.
 *
 * Meaningless until the account is registered, and the page says so rather than
 * printing a confident NO MATCH against an unregistered zero.
 */

type Result =
  | { kind: "idle" }
  | { kind: "unregistered" }
  | { kind: "done"; poolKey: string; lensKey: string; match: boolean };

export default function CompareClient() {
  const [wallets, setWallets] = useState<readonly WalletWithStarknetFeatures[]>([]);
  const [wallet, setWallet] = useState<WalletWithStarknetFeatures | null>(null);
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState("");
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const [error, setError] = useState("");

  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding from an external store on mount
    setWallets(store.getWallets().slice());
    const unsub = store.subscribe((next) => setWallets(next.slice()));
    return () => unsub();
  }, []);

  const network = NETWORKS[chainId && BigInt(chainId) === BigInt(NETWORKS.sepolia.chainId) ? "sepolia" : "mainnet"];

  async function connect(w: WalletWithStarknetFeatures) {
    setBusy(true);
    setError("");
    try {
      const accounts = (await walletV6.requestAccounts(w as never)) as string[];
      const chain = (await walletV6.requestChainId(w as never)) as string;
      setWallet(w);
      setAddress(accounts?.[0] ?? "");
      setChainId(chain);

      const net = NETWORKS[BigInt(chain) === BigInt(NETWORKS.sepolia.chainId) ? "sepolia" : "mainnet"];
      const key = await poolReader(providerFor(net), net.pool).getPublicKey(accounts?.[0] ?? "");
      setRegistered(key !== 0n);
      if (key === 0n) setResult({ kind: "unregistered" });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function compare() {
    if (!wallet) return;
    setBusy(true);
    setError("");
    try {
      const reader = poolReader(providerFor(network), network.pool);
      const onChain = await reader.getPublicKey(address);
      if (onChain === 0n) {
        setResult({ kind: "unregistered" });
        return;
      }

      // One signature, through the same typed data the Lens session flow uses.
      const feature = wallet.features[StarknetWalletApi];
      const signature = (await feature.request({
        type: "wallet_signTypedData",
        params: viewingKeyTypedData(network.chainId, network.pool) as never,
      })) as string[];

      // The derived key is a local const and stays one. Only its public half
      // is ever handed to state, which is what gets rendered.
      const derivedPublic = publicViewingKey(viewingKeyFromWalletSignature(signature));

      setResult({
        kind: "done",
        poolKey: `0x${onChain.toString(16)}`,
        lensKey: `0x${derivedPublic.toString(16)}`,
        match: derivedPublic === onChain,
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const btn: React.CSSProperties = { font: "inherit", padding: "0.6rem 1rem", cursor: "pointer" };
  const cell: React.CSSProperties = { padding: "0.35rem 1rem 0.35rem 0", color: "#777", whiteSpace: "nowrap", verticalAlign: "top" };

  return (
    <main style={{ maxWidth: "46rem", margin: "3rem auto", padding: "0 1.5rem", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.4rem", letterSpacing: "-0.01em" }}>
        Does Lens derive the key the wallet registered?
      </h1>
      <p style={{ color: "#666" }}>
        Development only, and read-only on chain. This asks for **one signature**, derives a viewing
        key from it in memory, and compares only the <em>public</em> halves. The private half is
        never rendered, logged, stored, or put into component state. Nothing is submitted and no
        funds move.
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
                ["Account", address],
                ["Network", `${network.label} ${chainId}`],
                ["Pool", network.pool],
                ["Registered", registered === null ? "reading…" : registered ? "yes" : "no"],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={cell}>{k}</td>
                  <td style={{ padding: "0.35rem 0", wordBreak: "break-all" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {registered === false && (
            <p style={{ marginTop: "1.2rem", padding: "0.9rem", border: "1px solid #ccc", color: "#555" }}>
              This account has never registered with the pool, so there is nothing to compare
              against. Running the test now would print a NO MATCH that means nothing. Shield
              first, which registers, then come back.
            </p>
          )}

          <button
            type="button"
            style={{ ...btn, marginTop: "1.5rem" }}
            disabled={busy || registered !== true}
            onClick={compare}
          >
            {busy ? "Waiting for the signature…" : "Sign once and compare public keys"}
          </button>

          {result.kind === "done" && (
            <div style={{ marginTop: "1.8rem" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <tbody>
                  <tr>
                    <td style={cell}>Ready pool public key</td>
                    <td style={{ padding: "0.35rem 0", wordBreak: "break-all" }}>{result.poolKey}</td>
                  </tr>
                  <tr>
                    <td style={cell}>Lens-derived public key</td>
                    <td style={{ padding: "0.35rem 0", wordBreak: "break-all" }}>{result.lensKey}</td>
                  </tr>
                </tbody>
              </table>
              <p style={{ marginTop: "1rem", fontSize: "1.1rem", color: result.match ? "#067d38" : "#777" }}>
                <strong>MATCH: {result.match ? "YES" : "NO"}</strong>
              </p>
              <p style={{ color: "#777", fontSize: "0.9rem" }}>
                {result.match
                  ? "A match would mean a normal wallet user can be read by Lens without a separate Lens-controlled registration. Report it before changing anything: this is a finding, not yet a decision."
                  : "No match, which is the expected result if the wallet derives its viewing key its own way. Nothing breaks; the existing Lens registration architecture stands."}
              </p>
            </div>
          )}

          {error && (
            <p style={{ marginTop: "1.2rem", color: "#a11", wordBreak: "break-word" }}>{error}</p>
          )}
        </section>
      )}
    </main>
  );
}
