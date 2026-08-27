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
 * The Ready side of the demo, development only.
 *
 * Ready owns its viewing key and its private state. This page never derives,
 * holds or reconstructs any of it and never builds a proof: every write goes
 * through `wallet_strk20InvokeTransaction`, so the wallet proves and submits
 * with its own proving service. There is deliberately no Lens prover path.
 *
 * There is deliberately no REGISTER button: Wallet API 0.10.3 defines exactly
 * three STRK20 methods and none of them registers a user.
 *
 * An earlier version of this page offered Shield while unregistered, on the
 * reading that the wallet would register the user inside the first shield. The
 * protocol does behave that way, and tx 0x4f5c1296… shows it: one
 * `apply_actions` emitting ViewingKeySet, Deposit and EncNoteCreated together.
 * The dapp Wallet API does not. Ready refused
 * `wallet_strk20InvokeTransaction` three times with code 118 NOT_REGISTERED,
 * returning no transaction hash and spending nothing.
 *
 * So every action here now requires an already-registered account, and the
 * first shield belongs in Ready's own interface.
 *
 * Nothing is submitted on load. Each write needs the exact confirmation phrase
 * typed, then a click, then Ready's own approval.
 */

const NET = NETWORKS.mainnet;
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const LENS = "0x47366fff6d7da5f313cf6a379f460c8544db248231a532e533afd588d801aca";
const DECIMALS = 18;
const UNIT = 10n ** BigInt(DECIMALS);

/**
 * The approved minimal plan: shield 2, transfer 1 to Lens, leave 1 shielded so
 * the disclosure snapshot has a visible remainder.
 *
 * Sized against the live balance. Each pool operation costs 6 STRK in protocol
 * fee plus roughly 2.9 STRK of gas, measured across eight real mainnet pool
 * transactions, so two Ready operations come to about 17.8 STRK before the
 * deposit itself. The deposit has to fit in what is left with room to spare.
 *
 * Every figure the page shows is derived from these constants, so the amount is
 * changed here and nowhere else.
 */
const DEPOSIT = 2n * UNIT;
const TRANSFER = 1n * UNIT;
const POOL_FEE = 6n * UNIT;
const CONFIRM = "I understand this spends real STRK";

type Registration = "unknown" | "registered" | "not registered" | "unreadable";

export default function ReadyClient() {
  const [wallets, setWallets] = useState<readonly WalletWithStarknetFeatures[]>([]);
  const [wallet, setWallet] = useState<WalletWithStarknetFeatures | null>(null);
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState("");
  const [busy, setBusy] = useState(false);
  const [publicWei, setPublicWei] = useState<bigint | null>(null);
  const [allowanceWei, setAllowanceWei] = useState<bigint | null>(null);
  const [privateStrk, setPrivateStrk] = useState("reading…");
  const [privateWei, setPrivateWei] = useState<bigint | null>(null);
  const [registration, setRegistration] = useState<Registration>("unknown");
  const [poolKey, setPoolKey] = useState("");
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
    // Registration and public balance come from the chain, not the wallet, so
    // they stay true even if the wallet is being unhelpful about the rest.
    const provider = providerFor(NET);
    const u256 = (r: string[]) => BigInt(r[0]) + (BigInt(r[1] ?? "0x0") << 128n);
    try {
      setPublicWei(
        u256(await provider.callContract({ contractAddress: STRK, entrypoint: "balanceOf", calldata: [who] })),
      );
      setAllowanceWei(
        u256(
          await provider.callContract({
            contractAddress: STRK,
            entrypoint: "allowance",
            calldata: [who, NET.pool],
          }),
        ),
      );
    } catch (e) {
      say(`balance: ${message(e)}`);
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
      const wei = entry ? BigInt(entry.balance) : 0n;
      setPrivateWei(wei);
      setPrivateStrk(formatAmount(wei, DECIMALS));
    } catch (e) {
      const c = classify(e);
      setPrivateWei(null);
      setPrivateStrk(c.verdict === "SUPPORTED" ? "none, not registered yet" : `unavailable: ${c.detail}`);
    }
  }

  /**
   * The only write path. It hands the wallet a description of the actions and
   * lets the wallet prove and submit them.
   */
  async function invoke(label: string, actions: unknown[]) {
    if (!wallet) return;
    if (confirm.trim() !== CONFIRM) return say(`${label}: refused, confirmation phrase does not match.`);
    if (BigInt(chainId || "0x0") !== BigInt(NET.chainId)) return say(`${label}: refused, wallet is not on ${NET.label}.`);
    setBusy(true);
    say(`${label}: sent to the wallet. Approve or reject it in Ready.`);
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

  const onMainnet = !!chainId && BigInt(chainId) === BigInt(NET.chainId);
  const armed = confirm.trim() === CONFIRM && !busy && onMainnet;
  const needed = DEPOSIT + POOL_FEE;
  const canAfford = publicWei !== null && publicWei >= needed;
  const hasPrivate = privateWei !== null && privateWei > 0n;

  /**
   * Shield used to be offered while unregistered, on the reading that the
   * wallet would register the user inside the first shield. The protocol does
   * work that way: a single `apply_actions` emits ViewingKeySet, Deposit and
   * EncNoteCreated together, and that is visible on chain.
   *
   * The dapp Wallet API does not. Ready refused
   * `wallet_strk20InvokeTransaction` three times with code 118
   * `NOT_REGISTERED`, returning no transaction hash and spending nothing. So
   * the wallet will bootstrap registration through its own interface but not
   * on a dapp's behalf, and offering the button here only produces a refusal.
   */
  const shieldBlock =
    registration !== "registered"
      ? "This Ready account is not yet registered with STRK20. Ready's dapp Wallet API does not bootstrap registration: it answers NOT_REGISTERED. Shield once inside Ready X first, then return here."
      : !canAfford
        ? `Needs ${formatAmount(needed, DECIMALS)} STRK (${formatAmount(DEPOSIT, DECIMALS)} deposit plus the ${formatAmount(POOL_FEE, DECIMALS)} pool fee).`
        : "";
  const transferBlock =
    registration !== "registered"
      ? "Not registered yet. Shield once inside Ready X first."
      : !hasPrivate
        ? "No shielded balance to send."
        : "";
  const unshieldBlock = !hasPrivate ? "No private balance." : "";

  const cell: React.CSSProperties = { padding: "0.3rem 1rem 0.3rem 0", color: "#777", whiteSpace: "nowrap", verticalAlign: "top" };
  const btn: React.CSSProperties = { font: "inherit", padding: "0.6rem 1rem", cursor: "pointer" };

  function Action({ label, block, onRun }: { label: string; block: string; onRun?: () => void }) {
    const enabled = !block && armed && !!onRun;
    return (
      <div>
        <button type="button" style={btn} disabled={!enabled} onClick={onRun}>
          {label}
        </button>
        <span style={{ marginLeft: "0.8rem", color: block ? "#a11" : "#067d38", fontSize: "0.85rem" }}>
          {block ? "DISABLED" : "AVAILABLE"}
        </span>
        {block && <p style={{ margin: "0.2rem 0 0", fontSize: "0.85rem", color: "#777" }}>{block}</p>}
      </div>
    );
  }

  return (
    <main style={{ maxWidth: "46rem", margin: "3rem auto", padding: "0 1.5rem", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.4rem", letterSpacing: "-0.01em" }}>Ready execution, development only</h1>
      <p style={{ color: "#666" }}>
        This page can spend real STRK on Starknet mainnet. Nothing is sent on load. Every write needs
        the confirmation phrase typed, a click, and then your own approval inside Ready. Ready keeps
        its viewing key and does its own proving; this page never sees either.
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
          <h2 style={{ fontSize: "1rem" }}>Pre-flight</h2>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {[
                ["Wallet", wallet.name],
                ["Account", address],
                ["Network", onMainnet ? `${NET.label} ${chainId}` : `${chainId}  NOT MAINNET, writes refused`],
                ["Token", `STRK ${STRK}`],
                ["Public STRK", publicWei === null ? "reading…" : formatAmount(publicWei, DECIMALS)],
                ["Allowance to pool", allowanceWei === null ? "reading…" : formatAmount(allowanceWei, DECIMALS)],
                ["Pool registration", registration],
                ["Registered public key", poolKey || "not read"],
                ["Private STRK", privateStrk],
                ["—", "—"],
                ["Shield amount", `${formatAmount(DEPOSIT, DECIMALS)} STRK`],
                ["Pool fee", `${formatAmount(POOL_FEE, DECIMALS)} STRK, charged on every pool operation`],
                ["Estimated gas", "not quotable here; the wallet builds and prices the transaction"],
                ["Screening", "required, and supplied by Ready. This is the only step that needs it"],
                ["Ready will request", "an STRK approval for the fee and the deposit, then one apply_actions call"],
                ["Expected after", `registered = yes, private STRK = ${formatAmount(DEPOSIT, DECIMALS)}, public STRK down by ${formatAmount(needed, DECIMALS)} plus gas`],
              ].map(([k, v], i) => (
                <tr key={`${k}-${i}`}>
                  <td style={cell}>{k}</td>
                  <td style={{ padding: "0.3rem 0", wordBreak: "break-all" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {registration !== "registered" && (
            <p style={{ marginTop: "1.2rem", padding: "0.9rem", border: "1px solid #ccc", color: "#555" }}>
              <strong>Shield once inside Ready X itself, then come back here.</strong>
              <br />
              This account is not registered with STRK20, and a dapp cannot fix that. Wallet API
              0.10.3 has no registration method, and Ready refuses{" "}
              <code>wallet_strk20InvokeTransaction</code> from a dapp while the account is
              unregistered: it answers code 118 <code>NOT_REGISTERED</code> and returns no
              transaction, so nothing is spent.
              <br />
              <br />
              At protocol level registration really does happen inside the first shield, as tx{" "}
              <code>0x4f5c129690bf459da7edc625d127ecf4eaad3985df713a986d07424666d9378</code> shows:
              one <code>apply_actions</code> emitting ViewingKeySet, Deposit and EncNoteCreated for a
              single pool fee. Ready will do that from its own interface. It just will not do it on a
              dapp&apos;s behalf.
            </p>
          )}

          <div style={{ marginTop: "1.8rem" }}>
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

          <div style={{ marginTop: "1.5rem", display: "grid", gap: "1.1rem" }}>
            <Action
              label={`Shield ${formatAmount(DEPOSIT, DECIMALS)} STRK`}
              block={shieldBlock}
              onRun={() => invoke("Shield", [{ type: "deposit", token: STRK, amount: `0x${DEPOSIT.toString(16)}` }])}
            />
            <Action
              label={`Private transfer ${formatAmount(TRANSFER, DECIMALS)} STRK to Lens`}
              block={transferBlock}
              onRun={() =>
                invoke("Transfer", [
                  { type: "transfer", token: STRK, amount: `0x${TRANSFER.toString(16)}`, recipient: LENS },
                ])
              }
            />
            <Action label="Unshield" block={unshieldBlock || "Not part of this demo."} />
          </div>

          <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#777" }}>
            Transfers also need the Lens account registered, because a private transfer needs the
            recipient&apos;s public viewing key to exist. Recipient:{" "}
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
