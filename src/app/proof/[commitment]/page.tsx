"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { type Disclosure } from "@/core/bundle";
import { parseProofLink } from "@/core/transport";
import { poolReader } from "@/core/read";
import { verifyDisclosure, type DisclosureResult } from "@/core/claim";
import {
  DisclosureStatus,
  STATUS_MEANING,
  getAuthorization,
  getDisclosureStatus,
  type Authorization,
} from "@/core/registry";
import {
  LATER_ACTIVITY,
  directionSentence,
  formatAmount,
  formatDate,
  fullAddress,
  sameAddress,
  shortAddress,
  summarize,
  tokenInfo,
  verdictFor,
} from "@/core/view";
import { networkForPool, providerFor } from "@/utils/networks";
import CopyButton from "../../components/CopyButton";

/**
 * The verifier's page. No wallet, no account, no server round trip for the
 * secret: the disclosure is read from the URL fragment, which browsers do not
 * transmit.
 *
 * Verification fails closed. Nothing about the payments is shown until every
 * required check has passed.
 */

type State =
  | { at: "reading" }
  | { at: "checking"; step: number }
  | {
      at: "done";
      disclosure: Disclosure;
      pool: DisclosureResult;
      status: DisclosureStatus;
      authorization?: Authorization;
    }
  | { at: "unreadable"; message: string };

const CHECK_STEPS = [
  "Reading the disclosure",
  "Checking it against the privacy pool",
  "Reading the authorization from Starknet",
];

export default function ProofPage() {
  const params = useParams<{ commitment: string }>();
  const [state, setState] = useState<State>({ at: "reading" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // The fragment never reaches the server. It is read here, in the browser,
      // and nothing in this function sends it anywhere.
      const fragment = window.location.hash.slice(1);
      let disclosure: Disclosure;
      try {
        disclosure = parseProofLink(params.commitment, fragment).disclosure;
      } catch (e) {
        if (!cancelled) setState({ at: "unreadable", message: (e as Error).message });
        return;
      }

      const network = networkForPool(disclosure.pool, disclosure.chainId);
      if (!network) {
        if (!cancelled) {
          setState({
            at: "unreadable",
            message: "This disclosure is for a network or privacy pool that Lens does not support.",
          });
        }
        return;
      }

      try {
        if (!cancelled) setState({ at: "checking", step: 1 });
        const provider = providerFor(network);
        const pool = await verifyDisclosure(poolReader(provider, network.pool), disclosure);

        if (!cancelled) setState({ at: "checking", step: 2 });
        let status = DisclosureStatus.Unknown;
        let authorization: Authorization | undefined;
        if (network.registry) {
          const commitment = params.commitment;
          status = await getDisclosureStatus(provider, network.registry, commitment);
          authorization = await getAuthorization(provider, network.registry, commitment);
        }

        if (!cancelled) setState({ at: "done", disclosure, pool, status, authorization });
      } catch {
        if (!cancelled) {
          setState({
            at: "unreadable",
            message:
              "Lens could not reach Starknet to check this disclosure. This is a connection problem, not a verdict. Try again in a moment.",
          });
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [params.commitment]);

  if (state.at === "reading" || state.at === "checking") {
    return (
      <Frame>
        <div className="panel">
          <p className="panel-title">Verifying</p>
          <ul className="progress">
            {CHECK_STEPS.map((label, i) => {
              const step = state.at === "checking" ? state.step : 0;
              return (
                <li key={label} className={i < step ? "done" : i === step ? "active" : ""}>
                  <span className="mark" aria-hidden="true">
                    {i < step ? "✓" : i === step ? "›" : "·"}
                  </span>
                  {label}
                </li>
              );
            })}
          </ul>
        </div>
      </Frame>
    );
  }

  if (state.at === "unreadable") {
    return (
      <Frame>
        <div className="verdict bad">
          <h1>Cannot verify</h1>
          <p>{state.message}</p>
        </div>
        <p className="sheet-note" style={{ marginTop: 20 }}>
          A proof link has a secret part after the # symbol. If it was shortened or retyped,
          ask the sender for the whole link again.
        </p>
      </Frame>
    );
  }

  return <Result {...state} />;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap narrow" style={{ paddingTop: 56, paddingBottom: 80 }}>
      {children}
    </div>
  );
}

function Result({
  disclosure,
  pool,
  status,
  authorization,
}: {
  disclosure: Disclosure;
  pool: DisclosureResult;
  status: DisclosureStatus;
  authorization?: Authorization;
}) {
  const view = verdictFor(pool, status);
  const s = summarize(disclosure);
  const { decimals } = tokenInfo(disclosure.scope.token);
  const holderMatches =
    authorization && sameAddress(authorization.holder, disclosure.scope.holder);

  return (
    <Frame>
      <div className={`verdict ${view.tone}`} role="status">
        <h1>{view.headline}</h1>
        <p>{view.detail}</p>
      </div>

      {view.verdict === "revoked" && authorization && (
        <div className="panel">
          <p className="panel-title">What revocation means</p>
          <dl className="facts">
            <div className="fact">
              <dt>Authorized</dt>
              <dd>{formatDate(authorization.createdAt)}</dd>
            </div>
            <div className="fact">
              <dt>Revoked</dt>
              <dd>{formatDate(authorization.revokedAt)}</dd>
            </div>
          </dl>
          <div className="notice" style={{ marginTop: 18 }}>
            <p>
              Information previously viewed or copied cannot be erased, and a retained channel
              key may still reveal this relationship. What changed is that the holder has
              publicly withdrawn authorization.
            </p>
          </div>
        </div>
      )}

      {view.verdict === "expired" && authorization && (
        <div className="panel">
          <p className="panel-title">Authorization expired</p>
          <dl className="facts">
            <div className="fact">
              <dt>Authorized</dt>
              <dd>{formatDate(authorization.createdAt)}</dd>
            </div>
            <div className="fact">
              <dt>Expired</dt>
              <dd>{formatDate(authorization.expiresAt)}</dd>
            </div>
          </dl>
          <p className="sheet-note" style={{ marginTop: 14 }}>
            {STATUS_MEANING[DisclosureStatus.Expired]}
          </p>
        </div>
      )}

      {view.verdict === "invalid" && (
        <div className="panel">
          <p className="panel-title">Why this failed</p>
          <p style={{ marginTop: 0 }}>{pool.reason}</p>
          <p className="sheet-note">
            Nothing about the payments is shown, because the disclosure did not match the data
            recorded on Starknet.
          </p>
        </div>
      )}

      {pool.verified && (
        <>
          <div className="panel">
            <p className="panel-title">Verified by Starknet</p>
            <p className="sheet-note" style={{ marginTop: -8, marginBottom: 14 }}>
              Each line was checked against the chain by this browser. None of it is taken on
              trust from the sender.
            </p>
            <Check ok>The channel belongs to the named relationship, in the stated direction</Check>
            <Check ok>The asset lane exists in the privacy pool</Check>
            <Check ok>The snapshot matches immutable notes in the pool</Check>
            <Check ok>The totals recompute from those notes</Check>
            <Check ok={status !== DisclosureStatus.Unknown}>
              {status === DisclosureStatus.Unknown
                ? "No holder authorization found on Starknet"
                : "The holder authorized this disclosure"}
            </Check>
            {authorization && (
              <Check ok={Boolean(holderMatches)}>
                {holderMatches
                  ? "The authorizing address matches the holder named in the disclosure"
                  : "The authorizing address does not match the holder named in the disclosure"}
              </Check>
            )}
            {authorization && (
              <Check ok>Authorized on {formatDate(authorization.createdAt)}</Check>
            )}
          </div>

          <div className="panel">
            <p className="panel-title">Authorized snapshot</p>
            <p className="sheet-note" style={{ marginTop: -8, marginBottom: 14 }}>
              What the holder chose to disclose, frozen when they approved it.
            </p>
            <dl className="facts">
              <div className="fact">
                <dt>Holder</dt>
                <dd>
                  <AddressLine value={disclosure.scope.holder} />
                </dd>
              </div>
              <div className="fact">
                <dt>Counterparty</dt>
                <dd>
                  <AddressLine value={disclosure.scope.counterparty} />
                </dd>
              </div>
              <div className="fact">
                <dt>Asset</dt>
                <dd>{s.symbol}</dd>
              </div>
              {s.lanes.map((lane) => (
                <div className="fact" key={lane.direction}>
                  <dt>{directionSentence(lane.direction, disclosure.scope.counterparty)}</dt>
                  <dd>
                    {lane.noteCount} payment{lane.noteCount === 1 ? "" : "s"}, {lane.total}{" "}
                    {s.symbol}
                  </dd>
                </div>
              ))}
              <div className="fact">
                <dt>Total</dt>
                <dd className="big">
                  {s.total} {s.symbol}
                </dd>
              </div>
            </dl>

            <details className="tech">
              <summary>Individual payments</summary>
              <table className="records" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Direction</th>
                    <th>Payment</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pool.lanes.flatMap((lane) =>
                    lane.notes.map((note) => (
                      <tr key={`${lane.direction}-${note.index}`}>
                        <td data-label="Direction">
                          {lane.direction === "inbound" ? "Received" : "Sent"}
                        </td>
                        <td data-label="Payment">#{note.index + 1}</td>
                        <td data-label="Amount">
                          {formatAmount(note.amount, decimals)} {s.symbol}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </details>
          </div>

          {pool.laterActivityDetected && (
            <div className="later">
              <h3 style={{ margin: "0 0 8px", fontSize: "0.98rem" }}>{LATER_ACTIVITY.headline}</h3>
              <p style={{ margin: 0, fontSize: "0.93rem", lineHeight: 1.55 }}>
                {LATER_ACTIVITY.detail}
              </p>
            </div>
          )}

          <div className="notice" style={{ marginTop: 22 }}>
            <h3>What this does not prove</h3>
            <p>
              A disclosure proves the payments it shows happened. It cannot prove that other
              payments did not, so do not read it as a complete financial picture.
            </p>
            <p>
              Lens does not verify who requested this or why. Any name or purpose attached to a
              request is an unverified label.
            </p>
          </div>
        </>
      )}

      <p className="sheet-note" style={{ marginTop: 28 }}>
        <Link href="/">What is Lens?</Link>
      </p>
    </Frame>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`check ${ok ? "pass" : "fail"}`}>
      <span className="mark" aria-hidden="true">
        {ok ? "✓" : "×"}
      </span>
      <span>
        <span className="sr-only">{ok ? "Verified: " : "Not verified: "}</span>
        {children}
      </span>
    </div>
  );
}

function AddressLine({ value }: { value: string }) {
  return (
    <span className="copyable">
      <span className="addr">{shortAddress(value)}</span>
      <CopyButton value={fullAddress(value)} label="Copy" />
    </span>
  );
}
