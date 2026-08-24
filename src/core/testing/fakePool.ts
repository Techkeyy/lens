/**
 * A pool that behaves like the real one for the parts we depend on.
 *
 * Test support, not shipped behaviour. It enforces the two properties the
 * snapshot model rests on: notes live at dense sequential indices, and a lane
 * only "exists" for a pair if it was registered for that pair.
 *
 * Crucially it is mutable, so a test can authorize a disclosure and then have a
 * payment arrive afterwards, which is the whole point of the snapshot.
 */

import {
  computeChannelKey,
  computeChannelMarker,
  computeNoteId,
  computeSubchannelMarker,
  encryptNoteAmount,
  type Felt,
} from "../derive";
import type { EncChannelInfo } from "../channels";
import type { NoteReader, StoredNote } from "../read";
import { encryptChannelInfo } from "../channels";
import { publicViewingKey } from "../session";

export type FakeLane = {
  key: bigint;
  sender: Felt;
  recipient: Felt;
  recipientPub: bigint;
};

export class FakePool implements NoteReader {
  private channels = new Set<string>();
  private subchannels = new Set<string>();
  private notes = new Map<string, StoredNote>();
  private laneCounts = new Map<string, number>();
  private publicKeys = new Map<string, bigint>();
  private inboundRecords: EncChannelInfo[] = [];

  register(address: Felt, viewingKey: bigint): bigint {
    const pub = publicViewingKey(viewingKey);
    this.publicKeys.set(BigInt(address).toString(), pub);
    return pub;
  }

  /** Open a lane, exactly as the pool records one. */
  openLane(lane: FakeLane, token: Felt) {
    this.channels.add(
      computeChannelMarker(lane.key, lane.sender, lane.recipient, lane.recipientPub).toString(),
    );
    this.subchannels.add(
      computeSubchannelMarker(lane.key, lane.recipient, lane.recipientPub, token).toString(),
    );
  }

  /** Publish the encrypted record that lets a recipient find an inbound lane. */
  publishInbound(ephemeral: bigint, recipientPub: bigint, channelKey: bigint, sender: bigint) {
    this.inboundRecords.push(encryptChannelInfo(ephemeral, recipientPub, channelKey, sender));
  }

  /** Append a payment at the next dense index, as the real pool would. */
  pay(channelKey: bigint, token: Felt, amount: bigint): number {
    const laneId = `${channelKey}:${BigInt(token)}`;
    const index = this.laneCounts.get(laneId) ?? 0;
    const noteId = computeNoteId(channelKey, token, index);
    this.notes.set(noteId.toString(), {
      index: -1,
      noteId,
      packedValue: encryptNoteAmount(channelKey, token, index, BigInt(1000 + index), amount),
      storedToken: 0n,
    });
    this.laneCounts.set(laneId, index + 1);
    return index;
  }

  /** Corrupt one note's amount, to prove tampering is caught. */
  rewriteAmount(channelKey: bigint, token: Felt, index: number, amount: bigint) {
    const noteId = computeNoteId(channelKey, token, index);
    this.notes.set(noteId.toString(), {
      index: -1,
      noteId,
      packedValue: encryptNoteAmount(channelKey, token, index, BigInt(1000 + index), amount),
      storedToken: 0n,
    });
  }

  /** Remove a note, to prove a gap inside the authorized range fails. */
  deleteNote(channelKey: bigint, token: Felt, index: number) {
    this.notes.delete(computeNoteId(channelKey, token, index).toString());
  }

  async getNote(noteId: Felt) {
    return this.notes.get(BigInt(noteId).toString());
  }
  async nullifierExists() {
    return false;
  }
  async getPublicKey(addr: Felt) {
    return this.publicKeys.get(BigInt(addr).toString()) ?? 0n;
  }
  async channelExists(marker: Felt) {
    return this.channels.has(BigInt(marker).toString());
  }
  async subchannelExists(marker: Felt) {
    return this.subchannels.has(BigInt(marker).toString());
  }
  async getNumOfChannels() {
    return this.inboundRecords.length;
  }
  async getChannelInfo(_recipient: Felt, index: number) {
    return this.inboundRecords[index];
  }
}

/** A Holder, a Counterparty, both registered, both lanes open. */
export function twoPartyWorld(opts: {
  holder: string;
  holderViewingKey: bigint;
  counterparty: string;
  counterpartyViewingKey: bigint;
  token: string;
}) {
  const pool = new FakePool();
  const holderPub = pool.register(opts.holder, opts.holderViewingKey);
  const counterpartyPub = pool.register(opts.counterparty, opts.counterpartyViewingKey);

  const outbound = computeChannelKey(
    opts.holder,
    opts.holderViewingKey,
    opts.counterparty,
    counterpartyPub,
  );
  const inbound = computeChannelKey(
    opts.counterparty,
    opts.counterpartyViewingKey,
    opts.holder,
    holderPub,
  );

  pool.openLane(
    { key: outbound, sender: opts.holder, recipient: opts.counterparty, recipientPub: counterpartyPub },
    opts.token,
  );
  pool.openLane(
    { key: inbound, sender: opts.counterparty, recipient: opts.holder, recipientPub: holderPub },
    opts.token,
  );
  // So the Holder can discover the inbound lane by ECDH, as they would live.
  pool.publishInbound(0x9999n, holderPub, inbound, BigInt(opts.counterparty));

  return { pool, outbound, inbound, holderPub, counterpartyPub };
}
