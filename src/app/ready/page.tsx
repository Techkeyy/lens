import { notFound } from "next/navigation";
import ReadyClient from "./ReadyClient";

/**
 * Development-only Ready execution surface.
 *
 * Kept out of production the same way `/probe` is: `next build` prerenders this
 * to a 404, and no `metadata` is exported so the 404 does not advertise it.
 *
 * This page can spend real money on mainnet. Every write is behind a typed
 * confirmation and a human click, and nothing is ever submitted on load.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ReadyClient />;
}
