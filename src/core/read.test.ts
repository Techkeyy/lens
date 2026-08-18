/**
 * Scan behaviour, tested against an in-memory pool built with the same
 * packing the real pool uses. No network.
 */

import { describe, expect, it } from "vitest";
import { computeNoteId, encryptNoteAmount, type Felt } from "./derive";
import { scanSubchannel, totalAmount, type NoteReader, type StoredNote } from "./read";

const CHANNEL = "0xdef";
const TOKEN = "0x1234";
const OTHER_CHANNEL = "0xbeef";

/** A pool holding exactly the notes we place in it, keyed by note id. */
function fakePool(
  entries: { channelKey: Felt; token: Felt; index: number; amount: bigint; salt: bigint }[],
  nullifiers: bigint[] = [],
): NoteReader {
  const store = new Map<string, StoredNote>();
  for (const e of entries) {
    const noteId = computeNoteId(e.channelKey, e.token, e.index);
    store.set(noteId.toString(), {
      index: -1,
      noteId,
      packedValue: encryptNoteAmount(e.channelKey, e.token, e.index, e.salt, e.amount),
      storedToken: 0n,
    });
  }
  const spent = new Set(nullifiers.map((n) => n.toString()));
  return {
    async getNote(noteId) {
      return store.get(BigInt(noteId).toString());
    },
    async nullifierExists(n) {
      return spent.has(BigInt(n).toString());
    },
    async getPublicKey() {
      return 0n;
    },
  };
}

const note = (index: number, amount: bigint, channelKey: Felt = CHANNEL) => ({
  channelKey,
  token: TOKEN,
  index,
  amount,
  salt: BigInt(1000 + index),
});

describe("scanSubchannel", () => {
  it("reads a dense run of notes and decrypts each amount", async () => {
    const reader = fakePool([note(0, 100n), note(1, 250n), note(2, 7n)]);
    const notes = await scanSubchannel(reader, CHANNEL, TOKEN);
    expect(notes.map((n) => n.amount)).toEqual([100n, 250n, 7n]);
    expect(notes.map((n) => n.index)).toEqual([0, 1, 2]);
    expect(totalAmount(notes)).toBe(357n);
  });

  it("stops at the first unwritten slot", async () => {
    // Index 3 exists but 2 does not, so the scan must stop at 2 and never
    // reach 3. Dense indices are what makes termination correct.
    const reader = fakePool([note(0, 10n), note(1, 20n), note(3, 999n)]);
    const notes = await scanSubchannel(reader, CHANNEL, TOKEN);
    expect(notes.map((n) => n.amount)).toEqual([10n, 20n]);
  });

  it("returns nothing for a channel with no notes", async () => {
    const reader = fakePool([note(0, 10n)]);
    expect(await scanSubchannel(reader, OTHER_CHANNEL, TOKEN)).toEqual([]);
  });

  it("sees nothing under the wrong token, since the note id changes", async () => {
    const reader = fakePool([note(0, 10n)]);
    expect(await scanSubchannel(reader, CHANNEL, "0x9999")).toEqual([]);
  });

  it("honours the safety stop instead of scanning forever", async () => {
    const many = Array.from({ length: 20 }, (_, i) => note(i, 1n));
    const reader = fakePool(many);
    const notes = await scanSubchannel(reader, CHANNEL, TOKEN, { maxIndex: 5 });
    expect(notes).toHaveLength(5);
  });

  it("keeps two channels separate, which is what bounds a disclosure", async () => {
    const reader = fakePool([
      note(0, 100n, CHANNEL),
      note(0, 5000n, OTHER_CHANNEL),
      note(1, 6000n, OTHER_CHANNEL),
    ]);
    const mine = await scanSubchannel(reader, CHANNEL, TOKEN);
    expect(totalAmount(mine)).toBe(100n);
    const theirs = await scanSubchannel(reader, OTHER_CHANNEL, TOKEN);
    expect(totalAmount(theirs)).toBe(11000n);
  });
});
