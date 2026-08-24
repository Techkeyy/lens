"use client";

import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { decodeRequest, type Request } from "@/core/bundle";
import { createDisclosure, type DisclosurePreview } from "@/core/disclose";
import { poolReader } from "@/core/read";
import { authorizeDisclosure } from "@/core/registry";
import { sessionFromSignature, viewingKeyTypedData, type Session } from "@/core/session";
import { buildProofLink, toDisclosureFile } from "@/core/transport";
import { WARNINGS } from "@/core/claim";
import {
  directionSentence,
  fullAddress,
  sameAddress,
  shortAddress,
  summarize,
  tokenInfo,
} from "@/core/view";
import { networkForPool, providerFor, txUrl } from "@/utils/networks";
import { useStoreWallet } from "../../components/Wallet/walletContext";
import ConnectWallet from "../../components/ConnectWallet";
import CopyButton from "../../components/CopyButton";

type Phase =
  | { at: "connect" }
  | { at: "signing" }
  | { at: "discovering"; step: number }
  | { at: "preview" }
  | { at: "authorizing"; step: string }
  | { at: "done"; hash: string }
  | { at: "error"; message: string; detail?: string };

const DISCOVERY_STEPS = [
  "Checking STRK20 registration",
  "Finding the private relationship",
  "Reading the authorized payment lanes",
  "Preparing the disclosure preview",
];

export default function HolderFlow() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const [phase, setPhase] = useState<Phase>({ at: "connect" });
  const [session, setSession] = useState<Session | undefined>();
  const [preview, setPreview] = useState<DisclosurePreview | undefined>();

  const address = useStoreWallet((s) => s.address);
  const chain = useStoreWallet((s) => s.chain);
  const walletAccount = useStoreWallet((s) => s.myWalletAccount);
  const isConnected = useStoreWallet((s) => s.isConnected);

  const expectedHolder = search.get("to") ?? "";

  const parsed = useMemo(() => {
    try {
      return { request: decodeRequest(decodeURIComponent(params.id)) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [params.id]);

  const request = parsed.request;
  const network = useMemo(
    () => (request ? networkForPool(request.pool, request.chainId) : undefined),
    [request],
  );

  if (parsed.error || !request || !network) {
    return (
      <Shell>
        <div className="verdict bad">
          <h1>Request not readable</h1>
          <p>{parsed.error ?? "This link does not describe a request Lens understands."}</p>
        </div>
        <p style={{ marginTop: 22 }}>
          <Link href="/request" className="btn btn-ghost">
            Create a new request
          </Link>
        </p>
      </Shell>
    );
  }

  const asset = tokenInfo(request.token);
  const wrongHolder =
    isConnected && expectedHolder && !sameAddress(address, expectedHolder);
  const wrongChain = isConnected && !sameAddress(chain, request.chainId);

  async function unlockAndDiscover() {
    if (!walletAccount || !request || !network) return;
    setPhase({ at: "signing" });
    try {
      const typedData = viewingKeyTypedData(request.chainId, request.pool);
      const signature = await walletAccount.signMessage(typedData as never);
      const list = Array.isArray(signature)
        ? (signature as string[])
        : ((signature as { r: string; s: string }).r
          ? [(signature as { r: string; s: string }).r, (signature as { r: string; s: string }).s]
          : []);
      const next = sessionFromSignature(address, request.chainId, request.pool, list);
      setSession(next);

      setPhase({ at: "discovering", step: 0 });
      const reader = poolReader(providerFor(network), network.pool);
      // The steps are real stages of the same call, advanced as it progresses,
      // rather than a fabricated percentage.
      setPhase({ at: "discovering", step: 1 });
      const built = await createDisclosure(reader, next, request);
      setPhase({ at: "discovering", step: 3 });
      setPreview(built);
      setPhase({ at: "preview" });
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      if (/reject|denied|abort|User abort/i.test(message)) {
        setPhase({ at: "connect" });
        return;
      }
      setPhase({
        at: "error",
        message: "Lens could not read this relationship.",
        detail: message,
      });
    }
  }

  async function authorize() {
    if (!preview || !walletAccount || !network?.registry) return;
    try {
      setPhase({ at: "authorizing", step: "Preparing the transaction" });
      const hash = await authorizeDisclosure(
        walletAccount as never,
        network.registry,
        preview.commitment,
        0,
      );
      setPhase({ at: "authorizing", step: "Confirming on Starknet" });
      await providerFor(network).waitForTransaction(hash);
      setPhase({ at: "done", hash });
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      if (/reject|denied|abort/i.test(message)) {
        setPhase({ at: "preview" });
        return;
      }
      setPhase({
        at: "error",
        message: "The authorization did not go through, so nothing was disclosed.",
        detail: message,
      });
    }
  }

  return (
    <Shell>
      <div className="pagehead">
        <h1>Disclosure request</h1>
        <p>
          Someone is asking you to prove one private payment relationship. Nothing is revealed
          until you approve it.
        </p>
      </div>

      <div className="panel">
        <p className="panel-title">What is being asked</p>
        <dl className="facts">
          <div className="fact">
            <dt>Relationship with</dt>
            <dd>
              <AddressLine value={request.counterparty} />
            </dd>
          </div>
          <div className="fact">
            <dt>Asset</dt>
            <dd>{asset.symbol}</dd>
          </div>
          <div className="fact">
            <dt>Network</dt>
            <dd>{network.label}</dd>
          </div>
          {request.requester && (
            <div className="fact">
              <dt>Requested by</dt>
              <dd>
                {request.requester}{" "}
                <span className="sheet-note">(unverified label, not checked by Lens)</span>
              </dd>
            </div>
          )}
          {request.purpose && (
            <div className="fact">
              <dt>Stated purpose</dt>
              <dd>
                {request.purpose}{" "}
                <span className="sheet-note">(context from the requester)</span>
              </dd>
            </div>
          )}
        </dl>
      </div>

      {phase.at === "error" && (
        <>
          <div className="verdict bad" style={{ marginTop: 18 }}>
            <h1>Something went wrong</h1>
            <p>{phase.message}</p>
          </div>
          {phase.detail && (
            <details className="tech">
              <summary>Details</summary>
              <pre>{phase.detail}</pre>
            </details>
          )}
        </>
      )}

      {phase.at === "connect" && (
        <div className="panel">
          <p className="panel-title">Step one</p>
          {!isConnected ? (
            <ConnectWallet
              network={network}
              why="Connect the wallet that received or sent these payments. Lens reads your history in your browser, and never asks for your viewing key."
            />
          ) : wrongChain ? (
            <div className="notice stern">
              <h3>Wrong network</h3>
              <p>
                This request is for {network.label}, and your wallet is connected to a different
                network. Switch networks in your wallet, then reload this page.
              </p>
            </div>
          ) : wrongHolder ? (
            <div className="notice stern">
              <h3>This request is for a different wallet</h3>
              <p>
                It was addressed to {shortAddress(expectedHolder)}, and you are connected as{" "}
                {shortAddress(address)}. Switch accounts in your wallet, then reload.
              </p>
            </div>
          ) : (
            <div className="stack">
              <p style={{ margin: 0 }}>
                Connected as <span className="addr">{shortAddress(address)}</span>
              </p>
              <p className="sheet-note" style={{ margin: 0 }}>
                Next you will sign one message. It grants no spending power. It unlocks your own
                payment history inside this browser so Lens can show you what a disclosure would
                reveal.
              </p>
              <div>
                <button type="button" className="btn btn-primary" onClick={unlockAndDiscover}>
                  Unlock my payment history
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase.at === "signing" && (
        <div className="panel">
          <p className="panel-title">Waiting for your wallet</p>
          <p style={{ margin: 0 }}>Approve the signature request in your wallet to continue.</p>
        </div>
      )}

      {phase.at === "discovering" && (
        <div className="panel">
          <p className="panel-title">Reading your relationship</p>
          <ul className="progress">
            {DISCOVERY_STEPS.map((label, i) => (
              <li
                key={label}
                className={i < phase.step ? "done" : i === phase.step ? "active" : ""}
              >
                <span className="mark" aria-hidden="true">
                  {i < phase.step ? "✓" : i === phase.step ? "›" : "·"}
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(phase.at === "preview" || phase.at === "authorizing") && preview && session && (
        <ConsentPreview
          preview={preview}
          request={request}
          busy={phase.at === "authorizing" ? phase.step : undefined}
          onAuthorize={authorize}
          registryMissing={!network.registry}
        />
      )}

      {phase.at === "done" && preview && (
        <Ready preview={preview} hash={phase.hash} explorer={txUrl(network, phase.hash)} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap narrow" style={{ paddingTop: 56, paddingBottom: 80 }}>
      {children}
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

function ConsentPreview({
  preview,
  request,
  busy,
  onAuthorize,
  registryMissing,
}: {
  preview: DisclosurePreview;
  request: Request;
  busy?: string;
  onAuthorize: () => void;
  registryMissing: boolean;
}) {
  const s = summarize(preview.disclosure);

  if (preview.empty) {
    return (
      <div className="panel">
        <p className="panel-title">Nothing to disclose</p>
        <p style={{ marginTop: 0 }}>
          Lens found no payments between you and {shortAddress(request.counterparty)} in{" "}
          {s.symbol}. There is nothing to authorize, so no transaction is offered.
        </p>
        <p className="sheet-note">
          If you expected payments here, check that the counterparty address and the asset in
          the request are the ones you used.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <p className="panel-title">You are about to reveal</p>
        <dl className="facts">
          <div className="fact">
            <dt>Relationship</dt>
            <dd>
              You and <span className="addr">{shortAddress(request.counterparty)}</span>
            </dd>
          </div>
          <div className="fact">
            <dt>Asset</dt>
            <dd>{s.symbol}</dd>
          </div>
          {s.lanes.map((lane) => (
            <div className="fact" key={lane.direction}>
              <dt>{directionSentence(lane.direction, request.counterparty)}</dt>
              <dd>
                {lane.noteCount} payment{lane.noteCount === 1 ? "" : "s"}, {lane.total} {s.symbol}
              </dd>
            </div>
          ))}
          <div className="fact">
            <dt>Authorized snapshot</dt>
            <dd className="big">
              {s.noteCount} payment{s.noteCount === 1 ? "" : "s"}, {s.total} {s.symbol}
            </dd>
          </div>
        </dl>
      </div>

      <div className="panel">
        <div className="split">
          <div>
            <p className="panel-title">This will reveal</p>
            <ul className="ledger will">
              <li>
                <span className="mark" aria-hidden="true">
                  ×
                </span>
                the payment history in this relationship
              </li>
              <li>
                <span className="mark" aria-hidden="true">
                  ×
                </span>
                the amounts in the authorized snapshot
              </li>
              <li>
                <span className="mark" aria-hidden="true">
                  ×
                </span>
                {s.lanes.length === 2 ? "both directions" : "the direction shown above"}
              </li>
              <li>
                <span className="mark" aria-hidden="true">
                  ×
                </span>
                a reusable key for the disclosed lanes
              </li>
            </ul>
          </div>
          <div>
            <p className="panel-title">This will not reveal</p>
            <ul className="ledger wont">
              <li>
                <span className="mark" aria-hidden="true">
                  ✓
                </span>
                your master viewing key
              </li>
              <li>
                <span className="mark" aria-hidden="true">
                  ✓
                </span>
                your private balance
              </li>
              <li>
                <span className="mark" aria-hidden="true">
                  ✓
                </span>
                any other counterparty
              </li>
              <li>
                <span className="mark" aria-hidden="true">
                  ✓
                </span>
                relationships in other assets
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="notice stern">
        <h3>Before you approve</h3>
        <p>{WARNINGS.bearer}</p>
        <p>{WARNINGS.reusableKey}</p>
        <p>
          Later activity in this relationship is not part of the snapshot you are authorizing
          now.
        </p>
        <p>{WARNINGS.noProvenDates}</p>
      </div>

      {registryMissing ? (
        <div className="notice" style={{ marginTop: 18 }}>
          <h3>Not available on this network yet</h3>
          <p>
            The Lens registry is not deployed on this network, so a disclosure cannot be
            authorized here.
          </p>
        </div>
      ) : (
        <div style={{ marginTop: 24 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onAuthorize}
            disabled={Boolean(busy)}
          >
            {busy ?? "Authorize this disclosure"}
          </button>
          {busy && (
            <p className="sheet-note" style={{ marginTop: 12 }} aria-live="polite">
              {busy}. Do not close this page.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function Ready({
  preview,
  hash,
  explorer,
}: {
  preview: DisclosurePreview;
  hash: string;
  explorer: string;
}) {
  // Built once, on the client, from the address bar itself. Keeping it out of
  // state avoids a render just to learn where we already are.
  const link = buildProofLink(
    typeof window === "undefined" ? "" : window.location.origin,
    preview.disclosure,
  );
  const s = summarize(preview.disclosure);

  function download() {
    const file = toDisclosureFile(preview.disclosure);
    const blob = new Blob([file.body], { type: file.contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="verdict ok" style={{ marginTop: 18 }}>
        <h1>Disclosure ready</h1>
        <p>
          Authorized on Starknet. {s.noteCount} payment{s.noteCount === 1 ? "" : "s"}, {s.total}{" "}
          {s.symbol}.
        </p>
      </div>

      <div className="panel">
        <p className="panel-title">Share this proof</p>
        <p className="addr" style={{ marginTop: 0 }}>
          {link.url}
        </p>
        <div className="row-actions" style={{ marginTop: 18 }}>
          <CopyButton value={link.url} label="Copy proof link" className="btn btn-primary" />
          <button type="button" className="btn btn-ghost" onClick={download}>
            Download disclosure file
          </button>
        </div>
        <div className="notice stern" style={{ marginTop: 20 }}>
          <h3>Treat this link like the document it is</h3>
          <p>Anyone with this proof link can inspect the disclosed relationship.</p>
          <p>{WARNINGS.revocation}</p>
        </div>
      </div>

      <div className="panel">
        <p className="panel-title">Record</p>
        <dl className="facts">
          <div className="fact">
            <dt>Authorization</dt>
            <dd>
              <a href={explorer} target="_blank" rel="noreferrer" className="addr">
                {shortAddress(hash, 10, 6)}
              </a>
            </dd>
          </div>
          <div className="fact">
            <dt>Manage</dt>
            <dd>
              <Link href="/disclosures">View and revoke your disclosures</Link>
            </dd>
          </div>
        </dl>
      </div>
    </>
  );
}
