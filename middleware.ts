import { type NextRequest, NextResponse } from "next/server";
import { platformAppUrl } from "@/lib/platform-url";
import { buildCsp } from "@/lib/security/csp";
import {
  TEST_ACCESS_COOKIE,
  TEST_ACCESS_PATH,
  hasTestAccess,
} from "@/lib/test-mode/access";

/**
 * Gives every page a fresh nonce and the matching Content-Security-Policy.
 * Next.js reads the policy from the request headers and puts the nonce on its
 * own scripts; our components read it from x-nonce. Uses only Web APIs, so it
 * runs on any middleware runtime (Vercel's edge as well as Node.js); the policy
 * follows the server's environment, read at request time.
 */
export async function middleware(request: NextRequest) {
  // A test site with TEST_SITE_PASSWORD shows only its password page until the password is entered.
  if (
    request.nextUrl.pathname !== TEST_ACCESS_PATH &&
    !(await hasTestAccess(request.cookies.get(TEST_ACCESS_COOKIE)?.value))
  ) {
    // Form posts and server actions get a plain refusal; page loads go to the password page.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new NextResponse(null, { status: 401 });
    }
    const url = new URL(TEST_ACCESS_PATH, request.url);
    url.searchParams.set(
      "next",
      request.nextUrl.pathname + request.nextUrl.search,
    );
    return NextResponse.redirect(url);
  }
  // Prefetches don't render a page the browser runs, so they need no policy.
  if (
    request.headers.get("next-router-prefetch") ||
    request.headers.get("purpose") === "prefetch"
  )
    return NextResponse.next();
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV !== "production",
    https: (platformAppUrl() ?? "").startsWith("https://"),
    storageUrls: [process.env.S3_ENDPOINT, process.env.S3_PUBLIC_BASE_URL],
    scriptUrls: [
      process.env.ANALYTICS_SCRIPT_URL,
      process.env.MARKETING_SCRIPT_URL,
    ],
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
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|icon|apple-icon|brand/|manifest.webmanifest|robots.txt|sitemap.xml|sw.js).*)",
  ],
};
