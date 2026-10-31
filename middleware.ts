import { type NextRequest, NextResponse } from "next/server";
import { buildCsp } from "@/lib/security/csp";

/**
 * Gives every page a fresh nonce and the matching Content-Security-Policy.
 * Next.js reads the policy from the request headers and puts the nonce on its
 * own scripts; our components read it from x-nonce. Runs on Node.js so the
 * policy follows the server's environment, not the build machine's.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV !== "production",
    https: (process.env.APP_URL ?? "").startsWith("https://"),
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
  runtime: "nodejs",
  matcher: [
    {
      // Pages only: API routes, static files and images don't run scripts.
      source: "/((?!api/|_next/static|_next/image|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
