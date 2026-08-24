"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { encodeLink, makeRequest } from "@/core/bundle";
import { KNOWN_TOKENS, isAddressLike, shortAddress } from "@/core/view";
import { DEFAULT_NETWORK, NETWORKS, type NetworkId } from "@/utils/networks";
import CopyButton from "../components/CopyButton";

/**
 * The requester's entry point. No wallet, no account, nothing on chain.
 *
 * A request carries no secret, so it is encoded straight into the link and
 * needs no backend to exist.
 */

type Which = "inbound" | "outbound" | "both";

const TOKEN_CHOICES = Object.entries(KNOWN_TOKENS).map(([address, t]) => ({
  address,
  ...t,
}));

export default function RequestPage() {
  const [network, setNetwork] = useState<NetworkId>(DEFAULT_NETWORK);
  const [holder, setHolder] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [token, setToken] = useState(TOKEN_CHOICES[1]?.address ?? TOKEN_CHOICES[0].address);
  const [which, setWhich] = useState<Which>("inbound");
  const [requester, setRequester] = useState("");
  const [purpose, setPurpose] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (holder && !isAddressLike(holder)) e.holder = "That does not look like a Starknet address.";
    if (counterparty && !isAddressLike(counterparty)) {
      e.counterparty = "That does not look like a Starknet address.";
    }
    if (
      holder &&
      counterparty &&
      isAddressLike(holder) &&
      isAddressLike(counterparty) &&
      BigInt(holder) === BigInt(counterparty)
    ) {
      e.counterparty = "The counterparty has to be someone other than the holder.";
    }
    return e;
  }, [holder, counterparty]);

  const ready =
    isAddressLike(holder) &&
    isAddressLike(counterparty) &&
    Object.keys(errors).length === 0;

  function build(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!ready) return;

    const config = NETWORKS[network];
    const request = makeRequest({
      chainId: config.chainId,
      pool: config.pool,
      requester: requester.trim(),
      purpose: purpose.trim(),
      counterparty: counterparty.trim(),
      token,
    });
    // The holder address and the requested direction travel as query hints on
    // the link. They are conveniences for the holder's screen, not part of the
    // signed request, so nothing here can quietly become a constraint.
    const encoded = encodeLink(request);
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    setLink(`${origin}/request/${encoded}?to=${holder.trim()}&dir=${which}`);
  }

  if (link) {
    const path = link.replace(/^https?:\/\/[^/]+/, "");
    return (
      <div className="wrap narrow" style={{ paddingTop: 56, paddingBottom: 80 }}>
        <div className="pagehead">
          <h1>Request ready</h1>
          <p>
            Send this link to the holder however you already talk to them. Nothing has been
            recorded on Starknet, and creating a request costs nothing.
          </p>
        </div>

        <div className="panel">
          <p className="panel-title">Request link</p>
          <p className="addr" style={{ marginTop: 0 }}>
            {link}
          </p>
          <div className="row-actions" style={{ marginTop: 18 }}>
            <CopyButton value={link} label="Copy request link" className="btn btn-primary" />
            <Link href={path} className="btn btn-ghost">
              Open the request
            </Link>
          </div>
        </div>

        <div className="panel">
          <p className="panel-title">What you asked for</p>
          <dl className="facts">
            <div className="fact">
              <dt>Holder</dt>
              <dd className="addr">{shortAddress(holder)}</dd>
            </div>
            <div className="fact">
              <dt>Counterparty</dt>
              <dd className="addr">{shortAddress(counterparty)}</dd>
            </div>
            <div className="fact">
              <dt>Asset</dt>
              <dd>{KNOWN_TOKENS[token]?.symbol ?? shortAddress(token)}</dd>
            </div>
            <div className="fact">
              <dt>Direction</dt>
              <dd>
                {which === "both"
                  ? "Both directions"
                  : which === "inbound"
                    ? "Payments received from the counterparty"
                    : "Payments sent to the counterparty"}
              </dd>
            </div>
            <div className="fact">
              <dt>Network</dt>
              <dd>{NETWORKS[network].label}</dd>
            </div>
          </dl>
          <p className="sheet-note" style={{ marginTop: 18 }}>
            The holder decides whether to answer. They will see exactly what a disclosure would
            reveal before they approve anything.
          </p>
        </div>

        <button className="btn btn-ghost" style={{ marginTop: 22 }} onClick={() => setLink(null)}>
          Make another request
        </button>
      </div>
    );
  }

  return (
    <div className="wrap narrow" style={{ paddingTop: 56, paddingBottom: 80 }}>
      <div className="pagehead">
        <h1>Request a disclosure</h1>
        <p>
          Ask someone to prove one private payment relationship. You need no wallet and no
          account, and this creates nothing on chain.
        </p>
      </div>

      <form onSubmit={build} noValidate>
        <div className="field">
          <label htmlFor="holder">Holder address</label>
          <span className="hint">The person you are asking. They will connect their wallet.</span>
          <input
            id="holder"
            className="mono"
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={Boolean(submitted && errors.holder)}
          />
          {submitted && !holder && <span className="err">Enter the holder&apos;s address.</span>}
          {errors.holder && <span className="err">{errors.holder}</span>}
        </div>

        <div className="field">
          <label htmlFor="counterparty">Counterparty address</label>
          <span className="hint">
            The other side of the relationship you want proved, such as their employer or
            client.
          </span>
          <input
            id="counterparty"
            className="mono"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={Boolean(submitted && errors.counterparty)}
          />
          {submitted && !counterparty && (
            <span className="err">Enter the counterparty&apos;s address.</span>
          )}
          {errors.counterparty && <span className="err">{errors.counterparty}</span>}
        </div>

        <div className="field">
          <label htmlFor="token">Asset</label>
          <span className="hint">One asset per disclosure.</span>
          <select id="token" value={token} onChange={(e) => setToken(e.target.value)}>
            {TOKEN_CHOICES.map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend>Which payments</legend>
          {(
            [
              ["inbound", "Payments received from the counterparty"],
              ["outbound", "Payments sent to the counterparty"],
              ["both", "Both directions"],
            ] as const
          ).map(([value, label]) => (
            <label className="choice" key={value}>
              <input
                type="radio"
                name="direction"
                value={value}
                checked={which === value}
                onChange={() => setWhich(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label htmlFor="requester">Who is asking (optional)</label>
          <span className="hint">
            Shown to the holder as context. Lens does not verify identities, so this is a label
            rather than a credential.
          </span>
          <input
            id="requester"
            value={requester}
            onChange={(e) => setRequester(e.target.value)}
            placeholder="Northside Lettings"
            maxLength={80}
          />
        </div>

        <div className="field">
          <label htmlFor="purpose">Why (optional)</label>
          <span className="hint">
            Free text, for the holder to read. Anything you write about dates is context only:
            a disclosure covers the whole relationship, not a calendar range.
          </span>
          <textarea
            id="purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            rows={3}
            maxLength={280}
            placeholder="Proof of income for a tenancy application"
          />
        </div>

        <div className="field">
          <label htmlFor="network">Network</label>
          <select
            id="network"
            value={network}
            onChange={(e) => setNetwork(e.target.value as NetworkId)}
          >
            {Object.values(NETWORKS).map((n) => (
              <option key={n.id} value={n.id} disabled={!n.registry}>
                {n.label}
                {n.registry ? "" : " (registry not deployed yet)"}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn btn-primary">
          Create request link
        </button>
      </form>
    </div>
  );
}
