import { notFound } from "next/navigation";
import ProbeClient from "./ProbeClient";

/**
 * A development-only capability probe.
 *
 * This is a diagnostic, not part of the product, so it does not exist in a
 * production build: `next build` prerenders this and gets a 404, and the route
 * never ships. Run it with `npm run dev` and open /probe.
 *
 * No `metadata` is exported on purpose: a title on a 404 would advertise a
 * route that is not supposed to exist in production.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ProbeClient />;
}
