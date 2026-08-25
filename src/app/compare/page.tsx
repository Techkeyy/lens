import { notFound } from "next/navigation";
import CompareClient from "./CompareClient";

/**
 * Development-only public-key comparison.
 *
 * Excluded from production the same way `/probe` and `/ready` are: `next build`
 * prerenders this to a 404, and no `metadata` is exported.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CompareClient />;
}
