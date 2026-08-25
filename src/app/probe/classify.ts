/**
 * Reading a wallet's refusal.
 *
 * The probe never executes a STRK20 action, so the only evidence it has about
 * whether a method exists is how the wallet says no. A wallet that has never
 * heard of a method fails differently from one that has it and disliked the
 * arguments, and that difference is the whole test.
 *
 * Kept out of the component so it can be tested, because getting this wrong is
 * how you report UNSUPPORTED for a wallet that supports everything.
 */

export type Verdict = "SUPPORTED" | "UNSUPPORTED" | "ERROR" | "UNKNOWN" | "SUPPORTED BY API";

/** Flatten an unknown throwable into one line, including a JSON-RPC code if present. */
export function message(e: unknown): string {
  const err = e as { message?: string; code?: number | string; data?: unknown };
  const parts = [
    err?.code !== undefined ? `code ${err.code}` : "",
    err?.message ?? String(e),
    typeof err?.data === "string" ? err.data : "",
  ].filter(Boolean);
  return parts.join(" · ").replace(/\s+/g, " ").trim().slice(0, 260);
}

export function classify(e: unknown): { verdict: Verdict; detail: string } {
  const m = message(e);

  // "is not a function" belongs here too: it is how the previous version of
  // this probe failed, by calling a method the wallet never published.
  if (
    /not[ _-]?(implemented|supported|available)|unknown method|unsupported method|no such method|method not found|is not a function/i.test(
      m,
    )
  ) {
    return { verdict: "UNSUPPORTED", detail: m };
  }

  // The wallet ran the method far enough to check pool registration, which it
  // could only do if the method exists.
  if (/NOT_REGISTERED/i.test(m)) {
    return {
      verdict: "SUPPORTED",
      detail: `${m}  (the method ran and answered about pool registration, so it exists)`,
    };
  }

  if (/INVALID_REQUEST_PAYLOAD|param|argument|invalid|schema|required|minitems|empty|length/i.test(m)) {
    return { verdict: "SUPPORTED", detail: `${m}  (an input complaint, so the method exists)` };
  }

  // The user closed the dialog. That says nothing either way, and pretending
  // otherwise would be the worst outcome here.
  if (/refus|reject|denied|abort|cancel/i.test(m)) {
    return { verdict: "UNKNOWN", detail: `${m}  (dismissed, so nothing was learned)` };
  }

  return { verdict: "ERROR", detail: m };
}
