import { describe, expect, it } from "vitest";
import { classify, message } from "./classify";

/** Shape a wallet error the way a JSON-RPC wallet actually throws one. */
function rpc(code: number, msg: string, data?: string) {
  return Object.assign(new Error(msg), { code, data });
}

describe("classify", () => {
  it("reads an absent method as unsupported", () => {
    for (const m of [
      "Method not implemented",
      "Method not supported by this wallet",
      "Unknown method wallet_strk20PrepareInvoke",
      "method not found",
      "wallet_strk20Balances is not available",
    ]) {
      expect(classify(new Error(m)).verdict, m).toBe("UNSUPPORTED");
    }
  });

  it("reads the bug that produced this file as unsupported, not as an error", () => {
    // The V2 probe called wallet.request(...) on a wallet-standard object.
    expect(classify(new TypeError("wallet.request is not a function")).verdict).toBe("UNSUPPORTED");
  });

  it("reads a complaint about the arguments as proof the method exists", () => {
    expect(classify(rpc(113, "INVALID_REQUEST_PAYLOAD: actions must contain at least one item")).verdict).toBe(
      "SUPPORTED",
    );
    expect(classify(new Error("params.actions failed schema: minItems 1")).verdict).toBe("SUPPORTED");
  });

  it("reads NOT_REGISTERED as proof the method exists", () => {
    // The wallet could only answer this after running the method.
    expect(classify(rpc(112, "NOT_REGISTERED")).verdict).toBe("SUPPORTED");
  });

  it("refuses to guess when the user dismissed the dialog", () => {
    for (const m of ["USER_REFUSED_OP", "User rejected the request", "aborted"]) {
      expect(classify(new Error(m)).verdict, m).toBe("UNKNOWN");
    }
  });

  it("does not claim support from an unrecognised failure", () => {
    expect(classify(new Error("network timeout")).verdict).toBe("ERROR");
  });

  it("keeps the rpc code in the detail so a human can look it up", () => {
    expect(message(rpc(63, "Method not implemented", "no handler"))).toContain("code 63");
    expect(message(rpc(63, "Method not implemented", "no handler"))).toContain("no handler");
  });

  it("collapses whitespace and caps runaway messages", () => {
    const m = message(new Error("a\n\n   b".padEnd(600, "x")));
    expect(m.startsWith("a b")).toBe(true);
    expect(m.length).toBeLessThanOrEqual(260);
  });
});
