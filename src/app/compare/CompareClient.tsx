"use client";

import { useEffect, useState } from "react";
import { walletV6 } from "starknet";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import {
  StarknetWalletApi,
  type WalletWithStarknetFeatures,
} from "@starknet-io/get-starknet-wallet-standard/features";
import { message } from "../probe/classify";
import { hash } from "starknet";
import {
  publicViewingKey,
  viewingKeyFromWalletSignature,
  viewingKeyMessage,
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

type Candidate = { label: string; note: string; derived?: string; match?: boolean; error?: string };

type Result =
  | { kind: "idle" }
  | { kind: "unregistered" }
  | { kind: "done"; poolKey: string; candidates: Candidate[]; anyMatch: boolean };

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

      const feature = wallet.features[StarknetWalletApi];
      const candidates: Candidate[] = [];

      /**
       * Two candidate derivations, because one of them cannot match by
       * construction and a NO on that alone would prove nothing.
       *
       * 1. Lens's own SNIP-12 typed data. Its domain literally says "Lens", so
       *    no wallet deriving a key independently could ever produce it.
       *    Included because it is what the product uses today.
       * 2. The derivation the sprint publishes as canonical: a signature over
       *    `starknetKeccak("chainId:pool")`. This is the one that could
       *    genuinely match. Wallets generally refuse to sign a bare hash, and
       *    that refusal is itself an answer.
       */
      const attempts: Array<{ label: string; note: string; run: () => Promise<string[]> }> = [
        {
          label: "Lens SNIP-12 typed data",
          note: 'the domain says "Lens", so a wallet-derived key cannot match this by construction',
          run: async () =>
            (await feature.request({
              type: "wallet_signTypedData",
              params: viewingKeyTypedData(network.chainId, network.pool) as never,
            })) as string[],
        },
        {
          label: "canonical starknetKeccak(chainId:pool)",
          note: "the derivation the sprint publishes; the only one that could actually match",
          run: async () => {
            const messageHash = hash.starknetKeccak(viewingKeyMessage(network.chainId, network.pool));
            return (await feature.request({
              type: "wallet_signMessage" as never,
              params: { message: `0x${messageHash.toString(16)}` } as never,
            })) as string[];
          },
        },
      ];

      for (const attempt of attempts) {
        try {
          // The derived key is a local const and stays one. Only its public
          // half reaches state, which is what gets rendered.
          const derivedPublic = publicViewingKey(viewingKeyFromWalletSignature(await attempt.run()));
          candidates.push({
            label: attempt.label,
            note: attempt.note,
            derived: `0x${derivedPublic.toString(16)}`,
            match: derivedPublic === onChain,
          });
        } catch (e) {
          candidates.push({ label: attempt.label, note: attempt.note, error: message(e) });
        }
      }

      setResult({
        kind: "done",
        poolKey: `0x${onChain.toString(16)}`,
        candidates,
        anyMatch: candidates.some((c) => c.match),
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
        Development only, and read-only on chain. This asks the wallet to sign two candidate
        messages, derives a viewing key from each in memory, and compares only the{" "}
        <em>public</em> halves. The private half is
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
              <p style={{ margin: 0 }}>
                <span style={{ color: "#777" }}>Registered pool public key</span>
                <br />
                <span style={{ wordBreak: "break-all" }}>{result.poolKey}</span>
              </p>
              {result.candidates.map((c) => (
                <div key={c.label} style={{ marginTop: "1.2rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                    <span>{c.label}</span>
                    <strong style={{ color: c.match ? "#067d38" : c.error ? "#777" : "#a11" }}>
                      {c.error ? "NOT SIGNED" : c.match ? "MATCH" : "NO MATCH"}
                    </strong>
                  </div>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "0.85rem", color: "#777" }}>{c.note}</p>
                  {c.derived && (
                    <p style={{ margin: "0.2rem 0 0", fontSize: "0.85rem", wordBreak: "break-all" }}>
                      {c.derived}
                    </p>
                  )}
                  {c.error && (
                    <p style={{ margin: "0.2rem 0 0", fontSize: "0.85rem", color: "#777", wordBreak: "break-word" }}>
                      {c.error}
                    </p>
                  )}
                </div>
              ))}
              <p style={{ marginTop: "1.4rem", fontSize: "1.05rem", color: result.anyMatch ? "#067d38" : "#777" }}>
                <strong>MATCH: {result.anyMatch ? "YES" : "NO"}</strong>
              </p>
              <p style={{ color: "#777", fontSize: "0.9rem" }}>
                {result.anyMatch
                  ? "Report this before changing anything. It is a finding, not a decision."
                  : "No match. Expected: a dapp cannot reproduce a key the wallet derived from the account private key, and if it could that would be a weakness in the wallet rather than a feature."}
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
