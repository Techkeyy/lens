/**
 * Everything Lens reads from the pool. I/O only, no decisions.
 *
 * All of it is public view calls. A verifier checking a disclosure needs no
 * wallet, no key and no permission: that property is the product, so it is
 * enforced here by never taking an account or a signer.
 */

import { RpcProvider } from "starknet";
import {
  type Felt,
  computeNoteId,
  computeNullifier,
  decryptNoteAmount,
  isEmptyNoteValue,
  toFelt,
} from "./derive";

/** A note as the pool stores it, plus where we found it. */
export type StoredNote = {
  index: number;
  noteId: bigint;
  packedValue: bigint;
  /** Clear only for open notes; encrypted notes carry the token in the payload. */
  storedToken: bigint;
};

/** A stored note after the channel key has been applied. */
export type ReadNote = StoredNote & {
  amount: bigint;
  salt: bigint;
};

export type NoteReader = {
  getNote(noteId: Felt): Promise<StoredNote | undefined>;
  nullifierExists(nullifier: Felt): Promise<boolean>;
  getPublicKey(userAddr: Felt): Promise<bigint>;
  channelExists(channelMarker: Felt): Promise<boolean>;
  subchannelExists(subchannelMarker: Felt): Promise<boolean>;
};

/** Reads against a live pool. `pool` is the STRK20 privacy pool address. */
export function poolReader(provider: RpcProvider, pool: string): NoteReader {
  return {
    async getNote(noteId: Felt) {
      const res = await provider.callContract({
        contractAddress: pool,
        entrypoint: "get_note",
        calldata: [toFelt(noteId).toString()],
      });
      const packedValue = BigInt(res[0]);
      if (isEmptyNoteValue(packedValue)) return undefined;
      return {
        index: -1,
        noteId: toFelt(noteId),
        packedValue,
        storedToken: BigInt(res[1] ?? "0x0"),
      };
    },

    async nullifierExists(nullifier: Felt) {
      const res = await provider.callContract({
        contractAddress: pool,
        entrypoint: "nullifier_exists",
        calldata: [toFelt(nullifier).toString()],
      });
      return BigInt(res[0]) !== 0n;
    },

    async getPublicKey(userAddr: Felt) {
      const res = await provider.callContract({
        contractAddress: pool,
        entrypoint: "get_public_key",
        calldata: [toFelt(userAddr).toString()],
      });
      return BigInt(res[0]);
    },

    async channelExists(channelMarker: Felt) {
      const res = await provider.callContract({
        contractAddress: pool,
        entrypoint: "channel_exists",
        calldata: [toFelt(channelMarker).toString()],
      });
      return BigInt(res[0]) !== 0n;
    },

    async subchannelExists(subchannelMarker: Felt) {
      const res = await provider.callContract({
        contractAddress: pool,
        entrypoint: "subchannel_exists",
        calldata: [toFelt(subchannelMarker).toString()],
      });
      return BigInt(res[0]) !== 0n;
    },
  };
}

/**
 * Walk one subchannel and read every note in it.
 *
 * Indices inside a channel's per-token subchannel are dense and sequential, so
 * the first unwritten slot ends the scan. `maxIndex` is a safety stop, not a
 * correctness bound.
 *
 * This is the whole of a scoped disclosure: hand someone a channel key and a
 * token, and they can reproduce exactly this and nothing else.
 */
export async function scanSubchannel(
  reader: NoteReader,
  channelKey: Felt,
  token: Felt,
  opts: { maxIndex?: number } = {},
): Promise<ReadNote[]> {
  const maxIndex = opts.maxIndex ?? 256;
  const notes: ReadNote[] = [];
  for (let index = 0; index < maxIndex; index++) {
    const noteId = computeNoteId(channelKey, token, index);
    const stored = await reader.getNote(noteId);
    if (!stored) break;
    const { amount, salt } = decryptNoteAmount(stored.packedValue, channelKey, token, index);
    notes.push({ ...stored, index, amount, salt });
  }
  return notes;
}

/**
 * Spent status for notes you own.
 *
 * Only useful to the note's owner, and deliberately not part of what a
 * disclosure proves. A nullifier is bound to the owner's private viewing key,
 * so a verifier cannot recompute one, which means a supplied nullifier is an
 * unverifiable assertion: a discloser could hand over any felt that happens to
 * be absent from the pool and call the note unspent. Treat the result as the
 * owner's own view, never as evidence in a claim.
 */
export async function spentStatus(
  reader: NoteReader,
  channelKey: Felt,
  token: Felt,
  index: number,
  ownerPrivateKey: Felt,
): Promise<boolean> {
  return reader.nullifierExists(computeNullifier(channelKey, token, index, ownerPrivateKey));
}

export function totalAmount(notes: ReadNote[]): bigint {
  return notes.reduce((sum, n) => sum + n.amount, 0n);
}
