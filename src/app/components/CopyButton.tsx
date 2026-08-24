"use client";

import { useEffect, useState } from "react";

/**
 * Copy with feedback that is announced, not only coloured, and that resets so
 * the control never gets stuck saying it succeeded.
 */
export default function CopyButton({
  value,
  label,
  copiedLabel = "Copied",
  className = "btn-tiny",
}: {
  value: string;
  label: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied && !failed) return;
    const t = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
    return () => clearTimeout(t);
  }, [copied, failed]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  }

  return (
    <button type="button" className={className} onClick={copy}>
      <span aria-live="polite">{failed ? "Press to select, then copy" : copied ? copiedLabel : label}</span>
    </button>
  );
}
