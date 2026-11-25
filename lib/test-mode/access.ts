/**
 * An optional password in front of a test-mode site (TEST_SITE_PASSWORD), so
 * only the people it's shared with can open it. A test site lets anyone sign in
 * as the demo admin, so once it sends real emails or SMS it should not be open
 * to the whole internet. Uses Web Crypto only, so middleware can call it.
 */

export const TEST_ACCESS_COOKIE = "tm_test_access";
export const TEST_ACCESS_PATH = "/test-access";

/**
 * The password: TEST_SITE_PASSWORD on a test-mode site, or PRELAUNCH_PASSWORD
 * on the live site before it opens to the public (so partners can set up their
 * shops first). Remove PRELAUNCH_PASSWORD to open the live site.
 */
export function testSitePassword(): string | undefined {
  if (process.env.TOWNMART_TEST_MODE !== "true") return process.env.PRELAUNCH_PASSWORD || undefined;
  return process.env.TEST_SITE_PASSWORD || undefined;
}

/** The cookie value that proves the password was entered: an HMAC of a fixed label, keyed by the password. */
export async function testAccessToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode("townmart-test-site-access"),
  );
  return Array.from(new Uint8Array(mac), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Compares in constant time for strings of equal length. */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when this request may see the site. */
export async function hasTestAccess(
  cookieValue: string | undefined,
): Promise<boolean> {
  const password = testSitePassword();
  if (!password) return true;
  return (
    !!cookieValue && sameString(cookieValue, await testAccessToken(password))
  );
}
