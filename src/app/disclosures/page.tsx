"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DisclosureStatus,
  listHolderAuthorizations,
  revokeDisclosure,
  type AuthorizationRecord,
} from "@/core/registry";
import { WARNINGS } from "@/core/claim";
import { STATUS_ROW_LABEL, formatDate, fullAddress, shortAddress } from "@/core/view";
import { DEFAULT_NETWORK, NETWORKS, providerFor, txUrl } from "@/utils/networks";
import { useStoreWallet } from "../components/Wallet/walletContext";
import ConnectWallet from "../components/ConnectWallet";
import CopyButton from "../components/CopyButton";

/**
 * The holder's own record.
 *
 * The source of truth is the chain, and the chain deliberately does not store
 * who a disclosure was with. So a row can say what was authorized and when, and
 * cannot say who it was about once the original bundle is gone. That is the
 * privacy decision showing its cost, and the page says so rather than hiding it
 * behind a friendlier label.
 */

type Load =
  | { at: "idle" }
  | { at: "loading" }
  | { at: "ready"; rows: AuthorizationRecord[] }
  | { at: "error"; message: string };

export default function DisclosuresPage() {
  const network = NETWORKS[DEFAULT_NETWORK];
  const address = useStoreWallet((s) => s.address);
  const isConnected = useStoreWallet((s) => s.isConnected);
  const walletAccount = useStoreWallet((s) => s.myWalletAccount);

  const [load, setLoad] = useState<Load>({ at: "loading" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isConnected || !address || !network.registry) return;
    try {
      const rows = await listHolderAuthorizations(
        providerFor(network),
        network.registry,
        address,
        { fromBlock: network.registryFromBlock },
      );
      setLoad({ at: "ready", rows });
    } catch {
      setLoad({
        at: "error",
        message:
          "Lens could not reach Starknet to read your disclosures. This is a connection problem. Try again in a moment.",
      });
    }
  }, [address, isConnected, network]);

  useEffect(() => {
    // The RPC is the external system here. State is only written from its
    // callback, never synchronously in the effect body.
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function revoke(commitment: string) {
    if (!walletAccount || !network.registry) return;
    setConfirming(null);
    setBusy(commitment);
    try {
      const hash = await revokeDisclosure(walletAccount as never, network.registry, commitment);
      await providerFor(network).waitForTransaction(hash);
      setLastTx(hash);
      // Update the row in place rather than reloading the whole page.
      setLoad((prev) =>
        prev.at === "ready"
          ? {
              at: "ready",
              rows: prev.rows.map((r) =>
                r.commitment === commitment
                  ? { ...r, status: DisclosureStatus.Revoked, revokedAt: Math.floor(Date.now() / 1000) }
                  : r,
              ),
            }
          : prev,
      );
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      if (!/reject|denied|abort/i.test(message)) {
        setLoad({
          at: "error",
          message: "The revocation did not go through. Your disclosure is unchanged.",
        });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wrap narrow" style={{ paddingTop: 56, paddingBottom: 80 }}>
      <div className="pagehead">
        <h1>My disclosures</h1>
        <p>
          Everything you have authorized, read from Starknet. You can withdraw authorization at
          any time.
        </p>
      </div>

      {!network.registry && (
        <div className="notice">
          <h3>Not available on this network yet</h3>
          <p>The Lens registry is not deployed on {network.label}.</p>
        </div>
      )}

      {!isConnected ? (
        <div className="panel">
          <p className="panel-title">Connect to continue</p>
          <ConnectWallet
            network={network}
            why="Connect the wallet you authorized disclosures with. Lens reads your record from the public registry, so no signature is needed here."
          />
        </div>
      ) : (
        <>
          <p className="sheet-note" style={{ marginBottom: 22 }}>
            Connected as <span className="addr">{shortAddress(address)}</span> on {network.label}
          </p>

          {load.at === "loading" && (
            <div className="panel">
              <p style={{ margin: 0 }}>Reading your disclosures from Starknet…</p>
            </div>
          )}

          {load.at === "error" && (
            <div className="verdict bad">
              <h1>Could not load</h1>
              <p>{load.message}</p>
              <button type="button" className="btn btn-ghost" style={{ marginTop: 16 }} onClick={refresh}>
                Try again
              </button>
            </div>
          )}

          {load.at === "ready" && load.rows.length === 0 && (
            <div className="panel">
              <p className="panel-title">Nothing yet</p>
              <p style={{ marginTop: 0 }}>
                You have not authorized any disclosures from this wallet. When someone asks you
                for proof, the request link they send will start the process.
              </p>
              <Link href="/request" className="btn btn-ghost" style={{ marginTop: 14 }}>
                See what a request looks like
              </Link>
            </div>
          )}

          {load.at === "ready" && load.rows.length > 0 && (
            <>
              <table className="records">
                <thead>
                  <tr>
                    <th>Disclosure</th>
                    <th>Authorized</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {load.rows.map((row) => (
                    <tr key={row.commitment}>
                      <td data-label="Disclosure">
                        <span className="copyable">
                          <span className="addr">{shortAddress(row.commitment, 8, 4)}</span>
                          <CopyButton value={fullAddress(row.commitment)} label="Copy" />
                        </span>
                      </td>
                      <td data-label="Authorized">{formatDate(row.createdAt)}</td>
                      <td data-label="Status">
                        <span className={`state ${STATUS_ROW_LABEL[row.status].toLowerCase()}`}>
                          {STATUS_ROW_LABEL[row.status]}
                        </span>
                        {row.status === DisclosureStatus.Revoked && row.revokedAt > 0 && (
                          <span className="sheet-note"> on {formatDate(row.revokedAt)}</span>
                        )}
                      </td>
                      <td data-label="Action">
                        {row.status === DisclosureStatus.Active ? (
                          <button
                            type="button"
                            className="btn-tiny"
                            onClick={() => setConfirming(row.commitment)}
                            disabled={busy === row.commitment}
                          >
                            {busy === row.commitment ? "Revoking…" : "Revoke"}
                          </button>
                        ) : (
                          <span className="sheet-note">No action</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {lastTx && (
                <p className="sheet-note" style={{ marginTop: 18 }} aria-live="polite">
                  Revocation recorded.{" "}
                  <a href={txUrl(network, lastTx)} target="_blank" rel="noreferrer">
                    View the transaction
                  </a>
                </p>
              )}
            </>
          )}

          <div className="notice" style={{ marginTop: 30 }}>
            <h3>Why these rows are anonymous</h3>
            <p>
              Lens keeps counterparties out of the public registry. After you lose the original
              disclosure link, Starknet can still prove that you created and revoked a
              disclosure, and it cannot reveal which private relationship it referred to.
            </p>
            <p>That is a privacy feature with a usability cost, and we would rather have it.</p>
          </div>
        </>
      )}

      {confirming && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Revoke authorization">
          <div className="modal">
            <div className="modal-head">
              <h2 className="modal-title">Revoke authorization?</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setConfirming(null)}
                aria-label="Close"
              >
                Close
              </button>
            </div>
            <div className="stack">
              <p style={{ margin: 0 }}>
                This marks the disclosure revoked on Starknet. Anyone checking its status will
                see that you withdrew authorization.
              </p>
              <div className="notice stern">
                <p>{WARNINGS.revocation}</p>
                <p>{WARNINGS.reusableKey}</p>
              </div>
              <div className="row-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={() => revoke(confirming)}>
                  Revoke authorization
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
