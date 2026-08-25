"use client";

import { useEffect, useState } from "react";
import { walletV6 } from "starknet";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";

/**
 * Read-only STRK20 capability probe.
 *
 * The first version of this scanned `window` for `starknet_*` keys. That found
 * nothing even with Ready installed and unlocked, because wallets are
 * discovered through the wallet-standard registry now, not by dropping an
 * enumerable global on `window`. This uses the same `createStore` discovery the
 * real ConnectWallet uses, so it exercises the path the product will use.
 *
 * What this page will do: ask the wallet to connect, read its identity, and
 * call the read-only `wallet_strk20Balances`.
 *
 * What it will never do: sign anything, submit anything, approve a token,
 * shield, unshield, transfer, or switch network.
 */

// Mainnet STRK and USDC. Used only as the token list for the read-only
// balances call, which needs a list and returns nothing if the wallet says no.
const TOKENS = [
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
];

type Verdict = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN" | "ERROR" | "SUPPORTED BY API";

const CHAINS: Record<string, string> = {
  "0x534e5f4d41494e": "Starknet mainnet",
  "0x534e5f5345504f4c4941": "Starknet Sepolia",
};

function message(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  return m.replace(/\s+/g, " ").trim().slice(0, 220);
}

/**
 * A wallet that does not implement a method and a wallet that rejects bad
 * parameters fail in different ways, and that difference is the whole test.
 * "Not implemented" and friends mean the method is absent; anything about the
 * arguments means the method is there and validated them.
 */
function classify(error: unknown): { verdict: Verdict; detail: string } {
  const m = message(error);
  if (/not (implemented|supported|available)|unknown method|unsupported method|no such method|method not found|invalid method/i.test(m)) {
    return { verdict: "UNSUPPORTED", detail: m };
  }
  if (/param|argument|invalid|schema|required|minitems|empty|length/i.test(m)) {
    return { verdict: "SUPPORTED", detail: `${m}  (an input complaint, so the method exists)` };
  }
  if (/reject|denied|abort|cancel/i.test(m)) {
    return { verdict: "UNKNOWN", detail: `${m}  (dismissed, so nothing was learned)` };
  }
  return { verdict: "UNKNOWN", detail: m };
}

type Row = { label: string; verdict: Verdict; detail?: string };

export default function ProbeClient() {
  const [wallets, setWallets] = useState<readonly WalletWithStarknetFeatures[]>([]);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<{
    name: string;
    version: string;
    address: string;
    chainId: string;
  } | null>(null);
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

  async function connect(wallet: WalletWithStarknetFeatures) {
    setBusy(true);
    setRows([]);
    setNotes([]);
    setDeep(false);
    const found: Row[] = [];
    const log: string[] = [];
    try {
      const w = wallet as never;
      const accounts = (await walletV6.requestAccounts(w)) as string[];
      const chainId = (await walletV6.requestChainId(w)) as string;

      let version = "not reported";
      try {
        const specs = await walletV6.supportedSpecs(w);
        version = Array.isArray(specs) ? specs.join(", ") : String(specs);
      } catch (e) {
        log.push(`wallet_supportedSpecs: ${message(e)}`);
      }

      setConnected(wallet);
      setIdentity({
        name: wallet.name ?? "unnamed",
        version,
        address: accounts?.[0] ?? "none returned",
        chainId,
      });

      // The sprint's own recommended capability test, and read-only.
      try {
        const balances = await (wallet as unknown as {
          request: (a: unknown) => Promise<unknown>;
        }).request({ type: "wallet_strk20Balances", params: { tokens: TOKENS } });
        found.push({
          label: "STRK20 balances API",
          verdict: "SUPPORTED",
          detail: JSON.stringify(balances).slice(0, 300),
        });
      } catch (e) {
        const c = classify(e);
        found.push({ label: "STRK20 balances API", verdict: c.verdict, detail: c.detail });
      }

      found.push({ label: "Shield / deposit", verdict: "UNKNOWN" });
      found.push({ label: "Private transfer", verdict: "UNKNOWN" });
      found.push({ label: "Unshield / withdraw", verdict: "UNKNOWN" });
      found.push({
        label: "Arbitrary registered recipient",
        verdict: "SUPPORTED BY API",
        detail:
          "Wallet API v0.10.3 types the transfer recipient as a plain ADDRESS, " +
          "described as the registered recipient inside the pool. No wallet-ownership, " +
          "contact or custody constraint. Runtime behaviour stays unverified until a real transfer.",
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
   * Method-existence check. Every call here is made with deliberately invalid
   * parameters: the action list is empty, and the spec requires at least one
   * item, so the wallet has nothing it could build, prompt for or submit. The
   * only thing read is which way it refuses.
   */
  async function checkMethods() {
    if (!connected) return;
    setBusy(true);
    const w = connected as unknown as { request: (a: unknown) => Promise<unknown> };
    const next = [...rows];
    const log = [...notes];

    const probes: Array<{ label: string; type: string }> = [
      { label: "Shield / deposit", type: "wallet_strk20PrepareInvoke" },
      { label: "Private transfer", type: "wallet_strk20PrepareInvoke" },
      { label: "Unshield / withdraw", type: "wallet_strk20PrepareInvoke" },
    ];

    // One call answers for all three: they are the same method with different
    // action variants, so if the method is absent none of them exist.
    let verdict: Verdict = "UNKNOWN";
    let detail = "";
    try {
      await w.request({ type: probes[0].type, params: { actions: [], simulate: true } });
      // A wallet that accepts an empty action list has answered without
      // building anything, which still tells us the method is present.
      verdict = "SUPPORTED";
      detail = "the method answered an empty action list without building anything";
    } catch (e) {
      const c = classify(e);
      verdict = c.verdict;
      detail = c.detail;
    }

    for (const p of probes) {
      const i = next.findIndex((r) => r.label === p.label);
      if (i >= 0) next[i] = { label: p.label, verdict, detail: `${p.type}: ${detail}` };
    }

    setRows(next);
    setNotes(log);
    setDeep(true);
    setBusy(false);
  }

  const colour = (v: Verdict) =>
    v === "SUPPORTED" || v === "SUPPORTED BY API"
      ? "var(--ok, #067d38)"
      : v === "UNSUPPORTED" || v === "ERROR"
        ? "var(--danger, #a11)"
        : "var(--muted, #777)";

  return (
    <main style={{ maxWidth: "44rem", margin: "3rem auto", padding: "0 1.5rem", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.4rem", letterSpacing: "-0.01em" }}>
        STRK20 wallet capability probe
      </h1>
      <p style={{ color: "var(--muted, #666)" }}>
        Development only. This asks the wallet what it can do. It never asks for a signature,
        never submits a transaction, never approves a token and never moves funds. Connecting
        is the only permission it requests.
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
                ["Wallet", `${identity.name} (wallet API ${identity.version})`],
                ["Address", identity.address],
                ["Network", `${CHAINS[identity.chainId] ?? "unrecognised"} ${identity.chainId}`],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: "0.3rem 1rem 0.3rem 0", color: "var(--muted, #777)", whiteSpace: "nowrap", verticalAlign: "top" }}>
                    {k}
                  </td>
                  <td style={{ padding: "0.3rem 0", wordBreak: "break-all", fontVariantNumeric: "tabular-nums" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: "1.6rem", display: "grid", gap: "1rem" }}>
            {rows.map((r) => (
              <div key={r.label}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                  <span>{r.label}</span>
                  <strong style={{ color: colour(r.verdict) }}>{r.verdict}</strong>
                </div>
                {r.detail && (
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--muted, #777)", wordBreak: "break-word" }}>
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
                onClick={checkMethods}
                disabled={busy}
                style={{ font: "inherit", padding: "0.6rem 1rem", cursor: "pointer" }}
              >
                {busy ? "Checking…" : "Check which STRK20 methods exist"}
              </button>
              <p style={{ fontSize: "0.85rem", color: "var(--muted, #777)", marginTop: "0.5rem" }}>
                This sends an empty action list on purpose. The spec requires at least one
                action, so the wallet has nothing it could build, prompt for or submit. The
                only thing read is which way it refuses.
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
