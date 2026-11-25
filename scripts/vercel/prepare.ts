/**
 * Runs before `next build` on Vercel (`pnpm vercel-build`): gets the database
 * ready for the code being deployed.
 *
 *   1. With the Neon integration (DATABASE_ROLES=auto, the default on Vercel):
 *      creates TownMart's roles and its own `townmart` database, as
 *      sql/bootstrap/roles.sql does on a server. Role passwords are derived
 *      from AUTH_SECRET (lib/platform.ts), so nothing else needs setting.
 *   2. Applies new migrations (prisma migrate deploy) as townmart_migrator.
 *   3. Seeds: reference data always; the demo shops, orders and accounts on a
 *      test-mode site (TOWNMART_TEST_MODE=true) or with SEED_DEMO_DATA=true.
 *      The live site (no test mode) seeds as production: only its first super
 *      admin, from SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD. Only
 *      its production builds run, so previews never touch the live database.
 *      The seed is idempotent, so this is safe on every deploy.
 *
 * Every step is safe to repeat.
 */
import { spawnSync } from "node:child_process";
import type { PrismaClient } from "@prisma/client";
import { asRole, AUTO_DB_NAME, autoRolePassword, databaseRoles, isTestMode, ownerDirectUrl } from "../../lib/platform";

// Read before Prisma loads, since Prisma reads a local .env into process.env.
const MODE = databaseRoles();
const MIGRATE_URL = process.env.MIGRATE_DATABASE_URL;

const ROLES = {
  townmart_migrator: "LOGIN NOSUPERUSER NOCREATEROLE",
  townmart_app: "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS",
  townmart_readonly: "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS",
} as const;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** Runs SQL that may already have been applied, or that the host doesn't allow; reports and carries on. */
async function optional(db: PrismaClient, sql: string, why: string) {
  try {
    await db.$executeRawUnsafe(sql);
  } catch (err) {
    console.log(`• skipped: ${why} (${err instanceof Error ? err.message.split("\n").at(-1) : err})`);
  }
}

async function bootstrap(ownerUrl: string) {
  const { PrismaClient } = await import("@prisma/client");
  const owner = new PrismaClient({ datasourceUrl: ownerUrl });
  try {
    for (const [role, attrs] of Object.entries(ROLES)) {
      const password = autoRolePassword(role); // base64url: no quotes to escape
      const exists = await owner.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM pg_roles WHERE rolname = ${role}`;
      // Only the password is reset on later runs: changing SUPERUSER-type attributes needs a superuser.
      await owner.$executeRawUnsafe(exists.length ? `ALTER ROLE ${role} PASSWORD '${password}'` : `CREATE ROLE ${role} ${attrs} PASSWORD '${password}'`);
    }
    // The connecting owner must be a member of the migrator to give it the database.
    await optional(owner, "GRANT townmart_migrator TO CURRENT_USER", "membership of townmart_migrator");
    const db = await owner.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM pg_database WHERE datname = ${AUTO_DB_NAME}`;
    if (!db.length) {
      await owner.$executeRawUnsafe(`CREATE DATABASE ${AUTO_DB_NAME} OWNER townmart_migrator`);
      console.log(`✓ created the ${AUTO_DB_NAME} database`);
    }
    await owner.$executeRawUnsafe(`REVOKE ALL ON DATABASE ${AUTO_DB_NAME} FROM PUBLIC`);
    await owner.$executeRawUnsafe(`GRANT CONNECT, TEMPORARY ON DATABASE ${AUTO_DB_NAME} TO townmart_app, townmart_readonly`);
  } finally {
    await owner.$disconnect();
  }

  const u = new URL(ownerUrl);
  u.pathname = `/${AUTO_DB_NAME}`;
  const inDb = new PrismaClient({ datasourceUrl: u.toString() });
  try {
    await inDb.$executeRawUnsafe("ALTER SCHEMA public OWNER TO townmart_migrator");
    await inDb.$executeRawUnsafe("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await inDb.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO townmart_app, townmart_readonly");
    await optional(inDb, "CREATE EXTENSION IF NOT EXISTS pg_stat_statements", "pg_stat_statements (only the slow-query panel needs it)");
    await optional(inDb, "GRANT pg_read_all_stats TO townmart_migrator", "pg_read_all_stats");
  } finally {
    await inDb.$disconnect();
  }
  console.log("✓ database roles are ready");
}

function run(cmd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed`);
}

/** Which expected settings this build can see (names only, never values), to tell a missing setting from a wrong one. */
function reportSettings() {
  const names = ["TOWNMART_TEST_MODE", "AUTH_SECRET", "DATA_ENCRYPTION_KEY", "DATA_HASH_KEY", "APP_URL", "CRON_SECRET", "HEALTH_KEY", "SEED_SUPER_ADMIN_EMAIL", "SEED_SUPER_ADMIN_PASSWORD", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "REDIS_URL", "KV_URL", "STORAGE_DRIVER", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_BASE_URL"];
  console.log(`Settings this ${process.env.VERCEL_ENV ?? "local"} build can see:`);
  for (const n of names) console.log(`  ${process.env[n] ? "✓" : "✗"} ${n}${n === "AUTH_SECRET" && process.env[n] ? ` (${process.env[n]!.length} characters)` : ""}`);
}

async function main() {
  reportSettings();
  // On the live site, only the production build may change the live database:
  // a preview of a work-in-progress branch must never migrate or seed it.
  if (!isTestMode() && process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "production") {
    fail(`This is the live site (TOWNMART_TEST_MODE isn't "true"), and ${process.env.VERCEL_ENV ?? "this"} builds would change its database. Only production builds run here: in the project's Settings → Git → Ignored Build Step, choose "Only build production".`);
  }
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) fail("Set AUTH_SECRET (32 characters or more) in the project's environment variables.");

  let migrateUrl: string;
  if (MODE === "auto") {
    const owner = ownerDirectUrl();
    if (!owner) fail("No database found. Connect a Neon Postgres database to the project (Storage tab), then redeploy.");
    await bootstrap(owner);
    migrateUrl = asRole(owner, "townmart_migrator", { pooled: false });
  } else {
    if (!MIGRATE_URL) fail("Set MIGRATE_DATABASE_URL (a direct connection as townmart_migrator).");
    migrateUrl = MIGRATE_URL;
  }

  // Children see MIGRATE_DATABASE_URL, which would otherwise switch them to manual roles.
  const roles = { DATABASE_ROLES: MODE };
  run("pnpm", ["exec", "prisma", "migrate", "deploy"], { ...roles, DATABASE_URL: migrateUrl, MIGRATE_DATABASE_URL: migrateUrl });

  const demo = isTestMode() || process.env.SEED_DEMO_DATA === "true";
  // The demo refunds and payouts need the pretend providers that test mode stands for.
  const pretend: Record<string, string> = isTestMode() ? { PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER ?? "fake", BANK_VERIFIER: process.env.BANK_VERIFIER ?? "fake" } : {};
  // The live site seeds as production whatever the builder sets: no demo shops, and staff accounts need real passwords.
  const live: Record<string, string> = isTestMode() ? {} : { NODE_ENV: "production" };
  run("pnpm", ["exec", "tsx", "prisma/seed.ts"], { ...roles, ...pretend, ...live, MIGRATE_DATABASE_URL: migrateUrl, ...(demo ? { SEED_DEMO_DATA: "true" } : {}) });
}

main().catch((err) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
