import { type NextRequest, NextResponse } from "next/server";
import { platformAppUrl } from "@/lib/platform-url";
import { buildCsp } from "@/lib/security/csp";

/**
 * Gives every page a fresh nonce and the matching Content-Security-Policy.
 * Next.js reads the policy from the request headers and puts the nonce on its
 * own scripts; our components read it from x-nonce. Uses only Web APIs, so it
 * runs on any middleware runtime (Vercel's edge as well as Node.js); the policy
 * follows the server's environment, read at request time.
 */
export function middleware(request: NextRequest) {
  // Prefetches don't render a page the browser runs, so they need no policy.
  if (request.headers.get("next-router-prefetch") || request.headers.get("purpose") === "prefetch") return NextResponse.next();
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV !== "production",
    https: (platformAppUrl() ?? "").startsWith("https://"),
    storageUrls: [process.env.S3_ENDPOINT, process.env.S3_PUBLIC_BASE_URL],
    scriptUrls: [process.env.ANALYTICS_SCRIPT_URL, process.env.MARKETING_SCRIPT_URL],
    extra: process.env.CSP_EXTRA_SOURCES,
  });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Pages only: API routes, static files and images don't run scripts. A plain
  // string, because Vercel's builder refuses matcher objects with conditions.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml).*)"],
};
