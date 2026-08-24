"use client";

import { useEffect, useState } from "react";
import { WalletAccountV6, validateAndParseAddress, walletV6 } from "starknet";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { useStoreWallet } from "./Wallet/walletContext";
import { providerFor, type NetworkConfig } from "@/utils/networks";

/**
 * Connect, with a reason attached.
 *
 * `why` is shown before the wallet dialog opens, because a connection prompt
 * with no stated purpose is the moment people abandon a flow.
 */
const EMPTY: readonly WalletWithStarknetFeatures[] = [];

export default function ConnectWallet({
  network,
  why,
  label = "Connect wallet",
}: {
  network: NetworkConfig;
  why: string;
  label?: string;
}) {
  const setAddress = useStoreWallet((s) => s.setAddressAccount);
  const setChain = useStoreWallet((s) => s.setChain);
  const setConnected = useStoreWallet((s) => s.setConnected);
  const setWalletAccount = useStoreWallet((s) => s.setMyWalletAccount);
  const setWalletObject = useStoreWallet((s) => s.setMyStarknetWalletObject);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [wallets, setWallets] = useState<readonly WalletWithStarknetFeatures[]>(EMPTY);

  // The discovery store hands back a fresh array on every read, so
  // useSyncExternalStore cannot be used without caching the snapshot, and an
  // uncached getSnapshot loops forever. Subscribing and copying into state is
  // the correct shape for this API.
  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding from an external store on mount
    setWallets(store.getWallets().slice());
    const unsub = store.subscribe((next) => setWallets(next.slice()));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function choose(wallet: WalletWithStarknetFeatures) {
    setBusy(true);
    setError("");
    try {
      const w = wallet as never;
      const accounts = await walletV6.requestAccounts(w);
      if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error("The wallet did not return an account.");
      }
      const chainId = (await walletV6.requestChainId(w)) as string;
      const account = await WalletAccountV6.connect(providerFor(network), w);

      setWalletObject(wallet);
      setAddress(validateAndParseAddress(accounts[0]));
      setChain(chainId);
      setWalletAccount(account);
      setConnected(true);
      setOpen(false);
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      setError(
        /reject|denied|abort/i.test(message)
          ? "You closed the wallet without connecting. Nothing happened."
          : "That wallet could not connect. Try again, or use a different wallet.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="sheet-note" style={{ marginBottom: 14 }}>
        {why}
      </p>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {label}
      </button>
      {error && (
        <p className="err" style={{ marginTop: 12, color: "var(--danger)" }} role="alert">
          {error}
        </p>
      )}

      {open && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Choose a wallet">
          <div className="modal">
            <div className="modal-head">
              <h2 className="modal-title">Choose a wallet</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setOpen(false)}
                disabled={busy}
                aria-label="Close"
              >
                Close
              </button>
            </div>
            {wallets.length === 0 ? (
              <div className="stack">
                <p>No Starknet wallet was found in this browser.</p>
                <p className="sheet-note">
                  Install a Starknet wallet such as Ready, then reload this page.
                </p>
              </div>
            ) : (
              <div className="stack">
                {wallets.map((w) => (
                  <button
                    key={w.name}
                    type="button"
                    className="btn btn-ghost btn-block"
                    onClick={() => choose(w)}
                    disabled={busy}
                  >
                    {busy ? "Connecting…" : w.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
