/**
 * Inbound lane recovery.
 *
 * A Holder cannot derive the key for a lane someone else opened. They can only
 * recover it by decrypting the record that sender published, using ECDH with
 * their own viewing key. If this does not work, "payments between you and this
 * address" is a false statement and the product must narrow its language.
 */

import { describe, expect, it } from "vitest";
import { ec } from "starknet";
import { decryptChannelInfo, encryptChannelInfo, findInboundChannel, type EncChannelInfo } from "./channels";
import { publicViewingKey } from "./session";

const ALICE_VK = 0x0a11ce5eecen;
const ALICE_PUB = publicViewingKey(ALICE_VK);
const EMPLOYER = 0x0e11907e2n;
const CHANNEL_KEY = 0xc0ffee1234567890n;
const EPHEMERAL = 0x777888999n;

const record = encryptChannelInfo(EPHEMERAL, ALICE_PUB, CHANNEL_KEY, EMPLOYER);

describe("channel record", () => {
  it("recovers the key and the sender the employer published", () => {
    const out = decryptChannelInfo(record, ALICE_VK);
    expect(out.channelKey).toBe(CHANNEL_KEY);
    expect(out.sender).toBe(EMPLOYER);
  });

  it("hides both from anyone else's viewing key", () => {
    const stranger = 0x1234567n;
    const out = decryptChannelInfo(record, stranger);
    expect(out.channelKey).not.toBe(CHANNEL_KEY);
    expect(out.sender).not.toBe(EMPLOYER);
  });

  it("publishes neither in the clear", () => {
    expect(record.encChannelKey).not.toBe(CHANNEL_KEY);
    expect(record.encSenderAddr).not.toBe(EMPLOYER);
  });
});

/** A pool holding a list of inbound records for one recipient. */
function source(records: EncChannelInfo[]) {
  return {
    async getNumOfChannels() {
      return records.length;
    },
    async getChannelInfo(_r: unknown, i: number) {
      return records[i];
    },
    async getPublicKey() {
      return ALICE_PUB;
    },
    async channelExists() {
      return true;
    },
  };
}

describe("findInboundChannel", () => {
  const other = encryptChannelInfo(0x111n, ALICE_PUB, 0xdeadn, 0x0c11e17n);

  it("finds the employer among several lanes", async () => {
    const found = await findInboundChannel(source([other, record]), "0x0a11ce", "0x0e11907e2", ALICE_VK);
    expect(found?.channelKey).toBe(CHANNEL_KEY);
    expect(found?.index).toBe(1);
  });

  it("returns nothing when that counterparty never paid", async () => {
    const found = await findInboundChannel(source([other]), "0x0a11ce", "0x0e11907e2", ALICE_VK);
    expect(found).toBeUndefined();
  });

  it("skips a malformed record rather than hiding later lanes", async () => {
    const broken = { ephemeralPubkey: 3n, encChannelKey: 1n, encSenderAddr: 1n };
    const found = await findInboundChannel(
      source([broken as EncChannelInfo, record]),
      "0x0a11ce",
      "0x0e11907e2",
      ALICE_VK,
    );
    expect(found?.channelKey).toBe(CHANNEL_KEY);
  });

  it("handles a holder with no inbound lanes at all", async () => {
    expect(await findInboundChannel(source([]), "0x0a11ce", "0x0e11907e2", ALICE_VK)).toBeUndefined();
  });
});
