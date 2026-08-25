"use client";

import { useEffect, useState } from "react";
import { walletV6 } from "starknet";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import {
  StarknetWalletApi,
  type WalletWithStarknetFeatures,
} from "@starknet-io/get-starknet-wallet-standard/features";
import { classify, message, type Verdict } from "./classify";

/**
 * Read-only STRK20 capability probe. Development only.
 *
 * Two bugs got us here, both mine, and both worth remembering.
 *
 * The first version scanned `window` for `starknet_*` globals and found
 * nothing while Ready was installed and unlocked. Wallets announce through the
 * wallet-standard registry now, so that scan could never have worked.
 *
 * The second version discovered the wallet correctly and then called
 * `wallet.request(...)`, which does not exist. A wallet-standard `Wallet` has
 * no request method of its own: the request function lives on a named feature.
 * `@starknet-io/get-starknet-wallet-standard` declares it as
 *
 *     features["starknet:walletApi"].request
 *
 * and starknet.js reaches it exactly that way internally. This version does the
 * same, so it uses the surface the wallet actually publishes.
 *
 * What this page will do: connect, read identity and announced features, and
 * call the read-only `wallet_strk20Balances`.
 *
 * What it will never do: sign, submit, approve a token, shield, unshield,
 * transfer, or switch network.
 */

// Mainnet STRK and USDC. An empty list would return every shielded token, which
// is more than a capability probe needs to see.
const TOKENS = [
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
];

const CHAINS: Record<string, string> = {
  "0x534e5f4d41494e": "Starknet mainnet (SN_MAIN)",
  "0x534e5f5345504f4c4941": "Starknet Sepolia (SN_SEPOLIA)",
};

type Row = { label: string; verdict: Verdict; detail?: string; sub?: string };

type Identity = {
  name: string;
  walletId: string;
  walletVersion: string;
  featureVersion: string;
  specs: string;
  address: string;
  chainId: string;
  features: string[];
  requestOwners: string[];
};

export default function ProbeClient() {
  const [wallets, setWallets] = useState<readonly WalletWithStarknetFeatures[]>([]);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [connected, setConnected] = useState<WalletWithStarknetFeatures | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [deep, setDeep] = useState(false);

  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding from an external store on mount
    setWallets(store.getWallets().slice());
    const unsub = store.subscribe((next) => setWallets(next.slice()));
    return () => unsub();
  }, []);

  /** The one place that knows how to reach the wallet API. */
  function api(wallet: WalletWithStarknetFeatures) {
    const feature = wallet.features[StarknetWalletApi];
    if (!feature || typeof feature.request !== "function") {
      throw new Error(
        `This wallet announces no usable "${StarknetWalletApi}" feature. Announced: ${Object.keys(wallet.features).join(", ")}`,
      );
    }
    return feature;
  }

  async function connect(wallet: WalletWithStarknetFeatures) {
    setBusy(true);
    setRows([]);
    setNotes([]);
    setDeep(false);
    const found: Row[] = [];
    const log: string[] = [];

    try {
      const feature = api(wallet);
      const w = wallet as never;

      const accounts = (await walletV6.requestAccounts(w)) as string[];
      const chainId = (await walletV6.requestChainId(w)) as string;

      let specs = "not reported";
      try {
        const s = await walletV6.supportedSpecs(w);
        specs = Array.isArray(s) ? s.join(", ") : String(s);
      } catch (e) {
        log.push(`wallet_supportedSpecs: ${message(e)}`);
      }

      // Non-sensitive structure only: which features exist, and which of them
      // actually owns a request function. Nothing about accounts or keys.
      const featureKeys = Object.keys(wallet.features);
      const requestOwners = featureKeys.filter((k) => {
        const f = (wallet.features as Record<string, unknown>)[k];
        return typeof (f as { request?: unknown })?.request === "function";
      });

      setConnected(wallet);
      setIdentity({
        name: wallet.name ?? "unnamed",
        walletId: feature.id ?? "not reported",
        walletVersion: feature.walletVersion ?? "not reported",
        featureVersion: feature.version ?? "not reported",
        specs,
        address: accounts?.[0] ?? "none returned",
        chainId,
        features: featureKeys,
        requestOwners,
      });

      // Read-only, and the sprint's own recommended capability test.
      try {
        const balances = await feature.request({
          type: "wallet_strk20Balances",
          params: { tokens: TOKENS },
        });
        found.push({
          label: "wallet_strk20Balances",
          verdict: "SUPPORTED",
          detail: JSON.stringify(balances).slice(0, 400),
        });
      } catch (e) {
        const c = classify(e);
        found.push({ label: "wallet_strk20Balances", verdict: c.verdict, detail: c.detail });
      }

      found.push({ label: "wallet_strk20PrepareInvoke", verdict: "UNKNOWN" });
      for (const label of ["Shield / deposit", "Private transfer", "Unshield / withdraw"]) {
        found.push({ label, verdict: "UNKNOWN", sub: "waiting on the prepare-invoke check" });
      }
      found.push({
        label: "Arbitrary registered recipient",
        verdict: "SUPPORTED BY API",
        detail:
          "Wallet API 0.10.3 types STRK20_TRANSFER_ACTION.recipient as a plain ADDRESS, " +
          "described as the registered recipient inside the pool. No wallet-ownership, contact " +
          "or custody constraint.",
        sub: "Runtime: UNVERIFIED until a real transfer is made.",
      });
    } catch (e) {
      log.push(`connect: ${message(e)}`);
    } finally {
      setRows(found);
      setNotes(log);
      setBusy(false);
    }
  }

  /**
   * Existence check for `wallet_strk20PrepareInvoke`.
   *
   * The action list is empty on purpose. The spec requires at least one action,
   * so there is no deposit, no transfer, no withdrawal and nothing executable
   * in this request. The wallet has nothing it could build, prompt for or
   * submit; the only thing read is which way it refuses. `simulate: true` is
   * set as a second belt, since it tells the wallet to skip proof generation
   * even if it somehow got that far.
   *
   * If a wallet opens a signing or confirmation dialog for this, that is a
   * finding about the wallet, and the probe stops there either way.
   */
  async function checkPrepareInvoke() {
    if (!connected) return;
    setBusy(true);
    const next = [...rows];

    let verdict: Verdict = "UNKNOWN";
    let detail = "";
    try {
      const feature = api(connected);
      await feature.request({
        type: "wallet_strk20PrepareInvoke",
        params: { actions: [], simulate: true },
      });
      verdict = "SUPPORTED";
      detail = "answered an empty action list without building anything";
    } catch (e) {
      const c = classify(e);
      verdict = c.verdict;
      detail = c.detail;
    }

    const put = (label: string, v: Verdict, d?: string, sub?: string) => {
      const i = next.findIndex((r) => r.label === label);
      const row = { label, verdict: v, detail: d, sub };
      if (i >= 0) next[i] = row;
      else next.push(row);
    };

    put("wallet_strk20PrepareInvoke", verdict, detail);

    // Deposit, transfer and withdraw are action variants of this one method,
    // so its presence answers for all three and its absence rules out all three.
    const viaPrepare: Verdict = verdict === "SUPPORTED" ? "SUPPORTED" : verdict;
    const sub =
      verdict === "SUPPORTED"
        ? "via prepare-invoke. Not executed."
        : "same method, so the same answer.";
    put("Shield / deposit", viaPrepare, undefined, sub);
    put("Private transfer", viaPrepare, undefined, sub);
    put("Unshield / withdraw", viaPrepare, undefined, sub);

    setRows(next);
    setDeep(true);
    setBusy(false);
  }

  const colour = (v: Verdict) =>
    v === "SUPPORTED" || v === "SUPPORTED BY API"
      ? "#067d38"
      : v === "UNSUPPORTED" || v === "ERROR"
        ? "#a11"
        : "#777";

  const cell: React.CSSProperties = {
    padding: "0.3rem 1rem 0.3rem 0",
    color: "#777",
    whiteSpace: "nowrap",
    verticalAlign: "top",
  };

  return (
    <main style={{ maxWidth: "46rem", margin: "3rem auto", padding: "0 1.5rem", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.4rem", letterSpacing: "-0.01em" }}>
        STRK20 wallet capability probe
      </h1>
      <p style={{ color: "#666" }}>
        Development only. This asks the wallet what it can do. It never asks for a signature,
        never submits a transaction, never approves a token, never moves funds and never
        switches network. Connecting is the only permission it requests.
      </p>

      {!identity && (
        <section style={{ marginTop: "2rem" }}>
          {wallets.length === 0 ? (
            <p>
              No Starknet wallet announced itself yet. If the extension is installed, reload
              this page once so it can announce.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "0.6rem" }}>
              {wallets.map((w) => (
                <button
                  key={w.name}
                  type="button"
                  onClick={() => connect(w)}
                  disabled={busy}
                  style={{ font: "inherit", padding: "0.6rem 1rem", cursor: "pointer", textAlign: "left" }}
                >
                  {busy ? "Connecting…" : `Connect ${w.name}`}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {identity && (
        <section style={{ marginTop: "2rem" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {[
                ["Wallet", `${identity.name}  (id ${identity.walletId}, build ${identity.walletVersion})`],
                ["Wallet API", identity.specs],
                ["Feature version", `${StarknetWalletApi} v${identity.featureVersion}`],
                ["Address", identity.address],
                ["Network", `${CHAINS[identity.chainId] ?? "unrecognised"} ${identity.chainId}`],
                ["Announced features", identity.features.join(", ")],
                ["Owns request()", identity.requestOwners.join(", ") || "none"],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={cell}>{k}</td>
                  <td style={{ padding: "0.3rem 0", wordBreak: "break-all" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: "1.8rem", display: "grid", gap: "1.1rem" }}>
            {rows.map((r) => (
              <div key={r.label}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                  <span>{r.label}</span>
                  <strong style={{ color: colour(r.verdict) }}>{r.verdict}</strong>
                </div>
                {r.sub && (
                  <p style={{ margin: "0.15rem 0 0", fontSize: "0.85rem", color: "#777" }}>{r.sub}</p>
                )}
                {r.detail && (
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "#777", wordBreak: "break-word" }}>
                    {r.detail}
                  </p>
                )}
              </div>
            ))}
          </div>

          {!deep && (
            <div style={{ marginTop: "1.8rem" }}>
              <button
                type="button"
                onClick={checkPrepareInvoke}
                disabled={busy}
                style={{ font: "inherit", padding: "0.6rem 1rem", cursor: "pointer" }}
              >
                {busy ? "Checking…" : "Check wallet_strk20PrepareInvoke"}
              </button>
              <p style={{ fontSize: "0.85rem", color: "#777", marginTop: "0.5rem" }}>
                Sends an empty action list on purpose. The spec requires at least one action,
                so there is no deposit, transfer or withdrawal in the request and nothing
                executable can come back. Only the shape of the refusal is read. If your
                wallet opens a signing dialog for this, close it and tell me.
              </p>
            </div>
          )}

          {notes.length > 0 && (
            <pre style={{ marginTop: "1.6rem", fontSize: "0.8rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {notes.join("\n")}
            </pre>
          )}
        </section>
      )}
    </main>
  );
}
