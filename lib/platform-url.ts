/**
 * The site's own address. Kept apart from lib/platform.ts, which uses
 * node:crypto, so middleware can import it on any runtime.
 */
/** APP_URL, or on Vercel the deployment's own address when APP_URL isn't set. */
export function platformAppUrl(): string | undefined {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL !== "1") return undefined;
  const host =
    process.env.VERCEL_ENV === "production"
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
      : (process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL);
  return host ? `https://${host}` : undefined;
}
