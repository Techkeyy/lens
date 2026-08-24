import { redirect } from "next/navigation";

/**
 * The leak scorer that used to live here is not this product. The source stays
 * in the repository for now; the route does not, so nobody arriving at the site
 * meets the previous project.
 */
export default function RetiredVault() {
  redirect("/");
}
