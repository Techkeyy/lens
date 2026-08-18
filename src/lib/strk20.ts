import type { WALLET_API } from "@starknet-io/types-js";
import { num } from "starknet";
import * as constants from "@/utils/constants";
import { prettyStatus } from "./format";

export type ActionResult = {
  status: "pending" | "ok" | "error";
  title: string;
  rows?: { label: string; value: string; hash?: string }[];
  note?: string;
};

export function errorResult(msg: string): ActionResult {
  return { status: "error", title: "Action failed", note: msg };
}

export async function submitStrk20(opts: {
  account: any;
  actions: WALLET_API.STRK20_ACTION[];
  networkIndex: number;
  amountLabel: string;
  onUpdate: (r: ActionResult) => void;
}): Promise<string | undefined> {
  const { account, actions, networkIndex, amountLabel, onUpdate } = opts;
  if (!account) {
    onUpdate(errorResult("Connect a Ready wallet first."));
    return undefined;
  }
  let txH: string;
  try {
    const r = await account.strk20InvokeTransaction(actions);
    txH = r.transaction_hash;
  } catch (error: any) {
    onUpdate(errorResult(error?.message ?? String(error)));
    return undefined;
  }
  onUpdate({
    status: "pending",
    title: "Waiting for the proof to land…",
    rows: [
      { label: "Amount", value: amountLabel },
      { label: "Transaction", value: txH.slice(0, 10) + "…", hash: txH },
    ],
  });
  const provider = constants.myFrontendProviders[networkIndex];
  try {
    const wait = provider.waitForTransaction(txH, {
      retries: 30,
      retryInterval: 3000,
    });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("WAIT_CEILING")), 90_000)
    );
    const txR: any = await Promise.race([wait, timeout]);
    const r = txR?.value ?? txR;
    const reverted = r?.execution_status === "REVERTED";
    onUpdate({
      status: reverted ? "error" : "ok",
      title: reverted ? "Transaction reverted" : "Confirmed on Starknet",
      rows: [
        { label: "Amount", value: amountLabel },
        { label: "Status", value: prettyStatus(r?.finality_status, r?.execution_status) },
        { label: "Transaction", value: txH.slice(0, 10) + "…", hash: txH },
      ],
    });
  } catch (error: any) {
    const ceiling = String(error?.message ?? error).includes("WAIT_CEILING");
    onUpdate({
      status: ceiling ? "ok" : "error",
      title: ceiling ? "Submitted. Check the explorer if the receipt is slow" : "Could not confirm transaction",
      rows: [{ label: "Transaction", value: txH.slice(0, 10) + "…", hash: txH }],
      note: ceiling
        ? "Paymaster-relayed pool txs can take a while to show up on the RPC. The hash is live."
        : error?.message ?? String(error),
    });
  }
  return txH;
}

export function hexAmt(n: bigint): string {
  return num.toHex(n);
}

/** Generic anonymizer call: withdraw to a helper, then privacy_invoke it. */
export function invokeActions(opts: {
  helper: string;
  token: string;
  amount: bigint;
  recipient: string;
  calldata: string[];
  withdraw: boolean;
}): WALLET_API.STRK20_ACTION[] {
  const actions: WALLET_API.STRK20_ACTION[] = [];
  if (opts.withdraw) {
    actions.push({
      type: "withdraw",
      token: opts.token,
      amount: hexAmt(opts.amount),
      recipient: opts.helper,
    });
  }
  actions.push({ type: "transfer", token: opts.token, amount: "OPEN", recipient: opts.recipient });
  actions.push({ type: "invoke", contract: opts.helper, calldata: opts.calldata });
  return actions;
}
