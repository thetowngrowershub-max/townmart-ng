import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import {
  TEST_ACCESS_COOKIE,
  TEST_ACCESS_PATH,
  sameString,
  testAccessToken,
  testSitePassword,
} from "@/lib/test-mode/access";
import { safeNextPath } from "@/lib/validation/auth";

export const dynamic = "force-dynamic";

/** Checks the test site's password and, if right, sets the access cookie for 30 days. */
export async function POST(request: NextRequest) {
  const password = testSitePassword();
  const form = await request.formData();
  const next = safeNextPath.parse(form.get("next")?.toString()) ?? "/";
  const back = (query: string) =>
    NextResponse.redirect(
      new URL(`${TEST_ACCESS_PATH}?${query}`, request.url),
      303,
    );
  if (!password) return NextResponse.redirect(new URL(next, request.url), 303);

  const { ipHash } = await requestMeta();
  const limit = await rateLimit(`test-access:${ipHash}`, 10, 15 * 60);
  if (!limit.allowed)
    return back(`error=limit&next=${encodeURIComponent(next)}`);

  const given = form.get("password")?.toString() ?? "";
  if (!sameString(given, password))
    return back(`error=wrong&next=${encodeURIComponent(next)}`);

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(TEST_ACCESS_COOKIE, await testAccessToken(password), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86_400,
  });
  return response;
}
