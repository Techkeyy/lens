/**
 * Getting a disclosure from the Holder to a Verifier without leaking it.
 *
 * A disclosure contains reusable channel keys. They must never reach a server,
 * a log, an analytics call or a referrer header. The URL fragment is the one
 * part of a link browsers do not transmit, so that is where the secret goes:
 *
 *     https://host/proof/<commitment>#<disclosure>
 *                        ^^^^^^^^^^^^  public, safe in a request
 *                                      ^^^^^^^^^^^ never leaves the browser
 *
 * The path carries the commitment only, which is a hash already published on
 * chain, so a server sees nothing it could not read from the registry.
 *
 * Two honest limitations, stated here so no interface can forget them:
 *
 *  - A fragment still lands in browser history, and in whatever the Verifier
 *    pasted the link into. This is a bearer credential, not a channel to one
 *    identified person.
 *  - Anyone who obtains the link can read the disclosure. There is no
 *    recipient authentication.
 */

import {
  type Disclosure,
  decodeDisclosure,
  disclosureCommitment,
  encodeLink,
  toBase64Url,
} from "./bundle";

export const PROOF_PATH = "/proof";

export type ProofLink = {
  /** Safe to log, send to a server, or show on screen. */
  path: string;
  /** The secret half. Never send this anywhere. */
  fragment: string;
  /** The whole thing, for the Holder to copy once and hand over. */
  url: string;
  commitment: string;
};

/**
 * Build the link a Holder shares.
 *
 * `origin` may be empty for a relative link. No trailing slash is assumed.
 */
export function buildProofLink(origin: string, disclosure: Disclosure): ProofLink {
  const commitment = disclosureCommitment(disclosure);
  const path = `${PROOF_PATH}/${commitment}`;
  const fragment = encodeLink(disclosure);
  const base = origin.replace(/\/+$/, "");
  return { path, fragment, url: `${base}${path}#${fragment}`, commitment };
}

export class ProofLinkError extends Error {}

/**
 * Read a proof link, refusing anything that does not hold together.
 *
 * The commitment in the path is not trusted: it is recomputed from the
 * fragment and compared. A mismatch means the link was edited, so the two
 * halves no longer describe the same disclosure and nothing is shown.
 */
export function parseProofLink(pathCommitment: string, fragment: string): {
  disclosure: Disclosure;
  commitment: string;
} {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!raw) {
    throw new ProofLinkError(
      "This proof link is missing its disclosure. The part after # was not included when it was copied.",
    );
  }

  let disclosure: Disclosure;
  try {
    disclosure = decodeDisclosure(raw);
  } catch (e) {
    throw new ProofLinkError((e as Error).message);
  }

  const commitment = disclosureCommitment(disclosure);
  if (!sameFelt(commitment, pathCommitment)) {
    throw new ProofLinkError(
      "This proof link does not match its own disclosure. It was altered after it was created, so nothing is shown.",
    );
  }
  return { disclosure, commitment };
}

/** Pull the commitment out of `/proof/0x…`, tolerating a trailing slash. */
export function commitmentFromPath(pathname: string): string | undefined {
  const m = pathname.match(/\/proof\/(0x[0-9a-fA-F]+)\/?$/);
  return m?.[1];
}

function sameFelt(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

/**
 * Second transport, for anyone who would rather not put a secret in a URL.
 *
 * A file avoids browser history entirely. The content is the same bundle, so
 * both routes verify identically.
 */
export function toDisclosureFile(disclosure: Disclosure): {
  filename: string;
  contentType: string;
  body: string;
} {
  const commitment = disclosureCommitment(disclosure);
  return {
    filename: `lens-disclosure-${commitment.slice(0, 10)}.lens.json`,
    contentType: "application/json",
    body: JSON.stringify(disclosure, null, 2),
  };
}

export function fromDisclosureFile(body: string): Disclosure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ProofLinkError("That file is not a Lens disclosure.");
  }
  return decodeDisclosure(toBase64Url(JSON.stringify(parsed)));
}

/**
 * Headers the proof route must send.
 *
 * `no-referrer` stops the URL, fragment included in some legacy paths, from
 * being handed to any site the Verifier clicks through to. `no-store` keeps the
 * page out of shared caches.
 */
export const PROOF_ROUTE_HEADERS: Record<string, string> = {
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};
