import { createHmac, hkdfSync } from "node:crypto";

/**
 * Settings that follow from where TownMart runs, read straight from
 * process.env so middleware, the root layout and build scripts can use them
 * without validating the whole environment (lib/env.ts does that).
 */

/**
 * Test mode, for a staging site people click through (TOWNMART_TEST_MODE=true).
 * Payments go through the pretend payment page, bank checks are faked, and
 * emails and SMS land in the on-site test inbox instead of being sent. A
 * banner on every page says no real money moves. Never set it on the live site.
 */
export const isTestMode = () => process.env.TOWNMART_TEST_MODE === "true";

/** True on Vercel (builds and functions alike). */
export const onVercel = () => process.env.VERCEL === "1";

/**
 * Background jobs run inside the web request that queued them, straight after
 * the response, instead of in the worker. For hosts that can't run the worker
 * (Vercel). Defaults to on there; JOBS_INLINE=false turns it off.
 */
export function jobsInline(): boolean {
  const v = process.env.JOBS_INLINE;
  if (v === "true") return true;
  if (v === "false") return false;
  return onVercel();
}

/** APP_URL, or on Vercel the deployment's own address when APP_URL isn't set. */
export function platformAppUrl(): string | undefined {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (!onVercel()) return undefined;
  const host =
    process.env.VERCEL_ENV === "production"
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
      : (process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL);
  return host ? `https://${host}` : undefined;
}

/** REDIS_URL, or the KV_URL that Vercel's Upstash integration sets. */
export const platformRedisUrl = () => process.env.REDIS_URL ?? process.env.KV_URL;

/**
 * A key derived from AUTH_SECRET, for a test-mode site that wasn't given its
 * own. Real sites set DATA_ENCRYPTION_KEY and DATA_HASH_KEY themselves.
 */
export function derivedKey(label: string): string {
  const secret = process.env.AUTH_SECRET ?? "";
  return Buffer.from(hkdfSync("sha256", secret, "townmart", label, 32)).toString("base64");
}

// ── Database roles chosen automatically (Vercel + Neon) ──────────────────────

export const AUTO_DB_NAME = "townmart";

/**
 * "auto" when the database came from a hosting integration (Vercel's Neon
 * integration sets DATABASE_URL to the owner's pooled connection). The build
 * (scripts/vercel/prepare.ts) then creates TownMart's three roles and its own
 * database, and the app connects as `townmart_app`, so row-level security
 * still applies. DATABASE_ROLES=manual uses DATABASE_URL as it is.
 */
export function databaseRoles(): "auto" | "manual" {
  const v = process.env.DATABASE_ROLES;
  if (v === "auto" || v === "manual") return v;
  return onVercel() && !process.env.MIGRATE_DATABASE_URL ? "auto" : "manual";
}

/** Passwords for the automatic roles, derived from AUTH_SECRET so build and runtime agree without extra settings. */
export function autoRolePassword(role: string): string {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "").update(`townmart-db-role:${role}`).digest("base64url");
}

/** The owner's direct (unpooled) connection from the integration. */
export const ownerDirectUrl = () => process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;
/** The owner's pooled connection from the integration. */
export const ownerPooledUrl = () => process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

/** Rewrites an owner connection string to log in as `role` on TownMart's own database. */
export function asRole(url: string, role: string, opts: { pooled: boolean }): string {
  const u = new URL(url);
  u.username = role;
  u.password = autoRolePassword(role);
  u.pathname = `/${AUTO_DB_NAME}`;
  if (opts.pooled) u.searchParams.set("pgbouncer", "true");
  if (!u.searchParams.has("sslmode")) u.searchParams.set("sslmode", "require");
  return u.toString();
}

/** The connection string the app uses at runtime. */
export function appDatabaseUrl(): string | undefined {
  if (databaseRoles() === "manual") return process.env.DATABASE_URL;
  const pooled = ownerPooledUrl();
  return pooled ? asRole(pooled, "townmart_app", { pooled: true }) : undefined;
}
