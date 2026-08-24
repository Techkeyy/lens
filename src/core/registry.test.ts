/**
 * The registry client, against a fake provider.
 *
 * Two properties matter here. Status reads must work with a provider and
 * nothing else, because a Verifier has no wallet. And a write must carry the
 * commitment and only the commitment, never the disclosure or its keys.
 *
 * The contract's own behaviour is tested in Cairo, not here.
 */

import { describe, expect, it, vi } from "vitest";
import {
  DisclosureStatus,
  STATUS_MEANING,
  authorizeDisclosure,
  getAuthorization,
  getDisclosureStatus,
  isAuthorized,
  listHolderAuthorizations,
  revokeDisclosure,
} from "./registry";

const REGISTRY = "0x0re915742";
const HOLDER = "0x0a11ce";
const COMMITMENT = "0x81a429c";
const CHANNEL_KEY = "0x7c0ffee1234567890abcdef";

/** Answers the four view calls the client makes. */
function fakeProvider(state: {
  status?: DisclosureStatus;
  auth?: [string, number, number, number];
  events?: { keys: string[] }[];
  pages?: number;
}) {
  let page = 0;
  return {
    callContract: vi.fn(async ({ entrypoint }: { entrypoint: string }) => {
      if (entrypoint === "status") return ["0x" + (state.status ?? 0).toString(16)];
      if (entrypoint === "is_authorized") {
        return [state.status === DisclosureStatus.Active ? "0x1" : "0x0"];
      }
      if (entrypoint === "get_authorization") {
        const a = state.auth ?? ["0x0", 0, 0, 0];
        return [a[0], "0x" + a[1].toString(16), "0x" + a[2].toString(16), "0x" + a[3].toString(16)];
      }
      throw new Error(`unexpected entrypoint ${entrypoint}`);
    }),
    getEvents: vi.fn(async () => {
      page += 1;
      const more = page < (state.pages ?? 1);
      return {
        events: state.events ?? [],
        continuation_token: more ? String(page) : undefined,
      };
    }),
  } as never;
}

describe("walletless status reads", () => {
  it("decodes every status the contract can return", async () => {
    for (const status of [
      DisclosureStatus.Unknown,
      DisclosureStatus.Active,
      DisclosureStatus.Revoked,
      DisclosureStatus.Expired,
    ]) {
      const provider = fakeProvider({ status });
      expect(await getDisclosureStatus(provider, REGISTRY, COMMITMENT)).toBe(status);
    }
  });

  it("needs only a provider, never an account", async () => {
    const provider = fakeProvider({ status: DisclosureStatus.Active });
    expect(await isAuthorized(provider, REGISTRY, COMMITMENT)).toBe(true);
  });

  it("reports a revoked disclosure as not authorized", async () => {
    const provider = fakeProvider({ status: DisclosureStatus.Revoked });
    expect(await isAuthorized(provider, REGISTRY, COMMITMENT)).toBe(false);
  });

  it("returns nothing for a commitment the registry never saw", async () => {
    const provider = fakeProvider({ auth: ["0x0", 0, 0, 0] });
    expect(await getAuthorization(provider, REGISTRY, COMMITMENT)).toBeUndefined();
  });

  it("decodes an authorization record", async () => {
    const provider = fakeProvider({ auth: [HOLDER, 1_724_000_000, 0, 0] });
    const auth = await getAuthorization(provider, REGISTRY, COMMITMENT);
    // Felts come back normalised, so compare numerically rather than by string.
    expect(BigInt(auth!.holder)).toBe(BigInt(HOLDER));
    expect(auth).toMatchObject({ createdAt: 1_724_000_000, expiresAt: 0, revokedAt: 0 });
  });

  it("says plainly that expiry is about authorization, not keys", () => {
    expect(STATUS_MEANING[DisclosureStatus.Expired]).toContain("No key stopped working");
    expect(STATUS_MEANING[DisclosureStatus.Revoked]).toContain("already received are not affected");
  });
});

describe("holder writes", () => {
  const account = { execute: vi.fn(async () => ({ transaction_hash: "0xtx" })) } as never;

  it("sends the commitment and nothing else when authorizing", async () => {
    const hash = await authorizeDisclosure(account, REGISTRY, COMMITMENT, 0);
    expect(hash).toBe("0xtx");
    const call = (account as unknown as { execute: { mock: { calls: unknown[][] } } }).execute.mock
      .calls[0][0] as { entrypoint: string; calldata: string[] };
    expect(call.entrypoint).toBe("authorize");
    expect(call.calldata).toHaveLength(2);
    expect(JSON.stringify(call)).not.toContain(CHANNEL_KEY);
  });

  it("passes an expiry through when the holder set one", async () => {
    await authorizeDisclosure(account, REGISTRY, COMMITMENT, 1_800_000_000);
    const calls = (account as unknown as { execute: { mock: { calls: unknown[][] } } }).execute.mock
      .calls;
    const call = calls[calls.length - 1][0] as { calldata: string[] };
    expect(call.calldata[1]).toBe("1800000000");
  });

  it("sends only the commitment when revoking", async () => {
    await revokeDisclosure(account, REGISTRY, COMMITMENT);
    const calls = (account as unknown as { execute: { mock: { calls: unknown[][] } } }).execute.mock
      .calls;
    const call = calls[calls.length - 1][0] as { entrypoint: string; calldata: string[] };
    expect(call.entrypoint).toBe("revoke");
    expect(call.calldata).toEqual([BigInt(COMMITMENT).toString()]);
  });
});

describe("holder history from chain events", () => {
  const ev = (commitment: string) => ({ keys: ["0xselector", commitment, HOLDER] });

  it("reconstructs commitments, timing and status", async () => {
    const provider = fakeProvider({
      events: [ev("0xaaa"), ev("0xbbb")],
      auth: [HOLDER, 1_724_000_000, 0, 0],
      status: DisclosureStatus.Active,
    });
    const rows = await listHolderAuthorizations(provider, REGISTRY, HOLDER);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe(DisclosureStatus.Active);
    expect(rows[0].createdAt).toBe(1_724_000_000);
  });

  it("deduplicates a commitment that appears in both authorize and revoke events", async () => {
    const provider = fakeProvider({
      events: [ev("0xaaa"), ev("0xaaa")],
      auth: [HOLDER, 100, 0, 200],
      status: DisclosureStatus.Revoked,
    });
    const rows = await listHolderAuthorizations(provider, REGISTRY, HOLDER);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(DisclosureStatus.Revoked);
  });

  it("follows pagination to the end", async () => {
    const provider = fakeProvider({
      events: [ev("0xaaa")],
      pages: 3,
      auth: [HOLDER, 1, 0, 0],
      status: DisclosureStatus.Active,
    });
    await listHolderAuthorizations(provider, REGISTRY, HOLDER);
    expect((provider as unknown as { getEvents: { mock: { calls: unknown[] } } }).getEvents.mock
      .calls).toHaveLength(3);
  });

  it("drops a record whose holder does not match, so events cannot be spoofed into a list", async () => {
    const provider = fakeProvider({
      events: [ev("0xaaa")],
      auth: ["0x0badbad", 1, 0, 0],
      status: DisclosureStatus.Active,
    });
    expect(await listHolderAuthorizations(provider, REGISTRY, HOLDER)).toHaveLength(0);
  });

  it("returns nothing for a holder with no disclosures", async () => {
    expect(await listHolderAuthorizations(fakeProvider({}), REGISTRY, HOLDER)).toEqual([]);
  });

  it("recovers timing and status but never what the disclosure was about", async () => {
    const provider = fakeProvider({
      events: [ev("0xaaa")],
      auth: [HOLDER, 1_724_000_000, 0, 0],
      status: DisclosureStatus.Active,
    });
    const [row] = await listHolderAuthorizations(provider, REGISTRY, HOLDER);
    // The record is deliberately opaque: no counterparty, no token, no amounts.
    expect(Object.keys(row).sort()).toEqual(
      ["commitment", "createdAt", "expiresAt", "holder", "revokedAt", "status"].sort(),
    );
  });
});
