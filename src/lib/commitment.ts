import { hash, num, shortString } from "starknet";
import { BID_COMMITMENT_TAG } from "@/utils/constants";

export function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export function computeCommitment(amount: bigint, salt: string): string {
  const tag = shortString.encodeShortString(BID_COMMITMENT_TAG);
  return hash.computePoseidonHashOnElements([tag, num.toHex(amount), salt]);
}

const SALT_KEY = "tender.bid-secrets.v1";

export type BidSecret = {
  auctionId: number;
  bidId: number;
  amount: string;
  salt: string;
  commitment: string;
};

function readAll(): BidSecret[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(SALT_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveSecret(secret: BidSecret) {
  const all = readAll().filter(
    (s) => !(s.auctionId === secret.auctionId && s.bidId === secret.bidId)
  );
  all.push(secret);
  localStorage.setItem(SALT_KEY, JSON.stringify(all));
}

export function secretsFor(auctionId: number): BidSecret[] {
  return readAll().filter((s) => s.auctionId === auctionId);
}

export function exportSecrets(): string {
  return JSON.stringify(readAll(), null, 2);
}

export function importSecrets(raw: string): number {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Expected an array of bid secrets.");
  const all = readAll();
  let added = 0;
  for (const s of parsed) {
    if (!s?.salt || s.auctionId == null) continue;
    const exists = all.some((x) => x.auctionId === s.auctionId && x.bidId === s.bidId && x.salt === s.salt);
    if (!exists) {
      all.push(s);
      added += 1;
    }
  }
  localStorage.setItem(SALT_KEY, JSON.stringify(all));
  return added;
}
