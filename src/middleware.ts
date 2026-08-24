import { NextResponse, type NextRequest } from "next/server";

/**
 * Headers for the proof route.
 *
 * These are also declared in next.config.js, but the dev server rewrites
 * Cache-Control for pages and drops `no-store`. Middleware runs on the
 * response either way, so the header a verifier actually receives is the one
 * set here.
 *
 * `no-referrer` matters because a proof URL carries a disclosure in its
 * fragment. `no-store` keeps the page out of shared caches.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/proof/")) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  }
  return response;
}

export const config = {
  matcher: "/proof/:path*",
};
