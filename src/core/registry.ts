/**
 * The Lens disclosure registry, from TypeScript.
 *
 * Two halves with very different requirements. Status reads must work for a
 * Verifier with no wallet, no account and no permission, so they take a plain
 * provider. Writes are the Holder authorizing or withdrawing, so they take an
 * account.
 *
 * No interface should build these calls by hand.
 */

import type { AccountInterface, ProviderInterface } from "starknet";
import { toFelt } from "./derive";

/** Mirrors the Cairo `Status` enum, in declaration order. */
export enum DisclosureStatus {
  Unknown = 0,
  Active = 1,
  Revoked = 2,
  Expired = 3,
}

export const STATUS_LABEL: Record<DisclosureStatus, string> = {
  [DisclosureStatus.Unknown]: "No such disclosure",
  [DisclosureStatus.Active]: "Authorized by the holder",
  [DisclosureStatus.Revoked]: "Authorization withdrawn by the holder",
  [DisclosureStatus.Expired]: "Authorization expired",
};

/**
 * What each status does and does not mean. Kept beside the enum so no screen
 * invents a softer reading.
 */
export const STATUS_MEANING: Record<DisclosureStatus, string> = {
  [DisclosureStatus.Unknown]:
    "The registry has no record of this disclosure. It was never authorized, or it was authorized on a different network.",
  [DisclosureStatus.Active]: "The holder authorized this disclosure and has not withdrawn it.",
  [DisclosureStatus.Revoked]:
    "The holder withdrew authorization. Information and keys already received are not affected.",
  [DisclosureStatus.Expired]:
    "The authorization passed the time the holder set. No key stopped working.",
};

export type Authorization = {
  holder: string;
  /** Unix seconds. Zero means no record exists. */
  createdAt: number;
  /** Zero means it does not lapse. */
  expiresAt: number;
  /** Zero means still authorized. */
  revokedAt: number;
};

export type AuthorizationRecord = Authorization & {
  commitment: string;
  status: DisclosureStatus;
};

const felt = (v: string | bigint | number) => "0x" + toFelt(v).toString(16);

// ---------------------------------------------------------------- reads

/** Status for a Verifier holding nothing at all. */
export async function getDisclosureStatus(
  provider: ProviderInterface,
  registry: string,
  commitment: string,
): Promise<DisclosureStatus> {
  const res = await provider.callContract({
    contractAddress: registry,
    entrypoint: "status",
    calldata: [toFelt(commitment).toString()],
  });
  return Number(BigInt(res[0])) as DisclosureStatus;
}

export async function getAuthorization(
  provider: ProviderInterface,
  registry: string,
  commitment: string,
): Promise<Authorization | undefined> {
  const res = await provider.callContract({
    contractAddress: registry,
    entrypoint: "get_authorization",
    calldata: [toFelt(commitment).toString()],
  });
  const createdAt = Number(BigInt(res[1]));
  if (createdAt === 0) return undefined;
  return {
    holder: felt(res[0]),
    createdAt,
    expiresAt: Number(BigInt(res[2])),
    revokedAt: Number(BigInt(res[3])),
  };
}

export async function isAuthorized(
  provider: ProviderInterface,
  registry: string,
  commitment: string,
): Promise<boolean> {
  const res = await provider.callContract({
    contractAddress: registry,
    entrypoint: "is_authorized",
    calldata: [toFelt(commitment).toString()],
  });
  return BigInt(res[0]) !== 0n;
}

// ---------------------------------------------------------------- writes

/**
 * Authorize a disclosure. The caller becomes its Holder.
 *
 * Only the commitment is sent. The disclosure, its keys and the counterparty
 * never appear in calldata.
 */
export async function authorizeDisclosure(
  account: AccountInterface,
  registry: string,
  commitment: string,
  expiresAt = 0,
): Promise<string> {
  const { transaction_hash } = await account.execute({
    contractAddress: registry,
    entrypoint: "authorize",
    calldata: [toFelt(commitment).toString(), String(expiresAt)],
  });
  return transaction_hash;
}

/** Withdraw authorization. Holder only, once. */
export async function revokeDisclosure(
  account: AccountInterface,
  registry: string,
  commitment: string,
): Promise<string> {
  const { transaction_hash } = await account.execute({
    contractAddress: registry,
    entrypoint: "revoke",
    calldata: [toFelt(commitment).toString()],
  });
  return transaction_hash;
}

// ------------------------------------------------------- holder history

/**
 * Rebuild a Holder's authorization history from chain events.
 *
 * This is the only source of truth that survives a cleared browser, a new
 * device, or a lost bundle. It returns commitments, timing and live status,
 * and **not** what any disclosure was about: the commitment is a hash and the
 * counterparty is deliberately not stored on chain.
 *
 * So a dashboard built on this can honestly say "three active disclosures,
 * created on these dates". It cannot say who they were with unless the browser
 * still holds the original bundle.
 */
export async function listHolderAuthorizations(
  provider: ProviderInterface,
  registry: string,
  holder: string,
  opts: { fromBlock?: number; toBlock?: number | "latest"; chunkSize?: number } = {},
): Promise<AuthorizationRecord[]> {
  const chunkSize = opts.chunkSize ?? 100;
  const holderFelt = felt(holder);
  const commitments = new Set<string>();

  let continuationToken: string | undefined;
  do {
    const page = await provider.getEvents({
      address: registry,
      from_block: { block_number: opts.fromBlock ?? 0 },
      to_block: opts.toBlock === "latest" || opts.toBlock === undefined
        ? "latest"
        : { block_number: opts.toBlock },
      // keys[0] is the event selector, keys[1] the commitment, keys[2] the
      // holder. Leaving the first two open matches both event types.
      keys: [[], [], [holderFelt]],
      chunk_size: chunkSize,
      continuation_token: continuationToken,
    });
    for (const ev of page.events) {
      const commitment = ev.keys[1];
      if (commitment) commitments.add(felt(commitment));
    }
    continuationToken = page.continuation_token;
  } while (continuationToken);

  const records: AuthorizationRecord[] = [];
  for (const commitment of commitments) {
    const auth = await getAuthorization(provider, registry, commitment);
    if (!auth) continue;
    if (BigInt(auth.holder) !== BigInt(holder)) continue;
    records.push({
      ...auth,
      commitment,
      status: await getDisclosureStatus(provider, registry, commitment),
    });
  }
  return records.sort((a, b) => b.createdAt - a.createdAt);
}
