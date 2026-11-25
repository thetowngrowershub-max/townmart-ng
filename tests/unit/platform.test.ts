import { afterEach, describe, expect, it, vi } from "vitest";
import { keyBytes, productionProblems, withPlatformDefaults, type Env } from "@/lib/env";
import { intervalMinutes } from "@/lib/jobs/schedule";
import { testSitePassword } from "@/lib/test-mode/access";
import { appDatabaseUrl, asRole, autoRolePassword, databaseRoles, jobsInline, platformAppUrl } from "@/lib/platform";

afterEach(() => vi.unstubAllEnvs());

describe("scheduled jobs without the worker", () => {
  it("turns cron patterns into intervals", () => {
    expect(intervalMinutes("* * * * *")).toBe(1);
    expect(intervalMinutes("*/15 * * * *")).toBe(15);
    expect(intervalMinutes("10,40 * * * *")).toBe(60);
    expect(intervalMinutes("0 10 * * 1-5")).toBe(1440);
  });
});

describe("Vercel", () => {
  it("runs jobs inline and works out its own address", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "townmart-ng.vercel.app");
    delete process.env.APP_URL;
    expect(jobsInline()).toBe(true);
    expect(platformAppUrl()).toBe("https://townmart-ng.vercel.app");
    vi.stubEnv("JOBS_INLINE", "false");
    expect(jobsInline()).toBe(false);
  });

  it("connects as townmart_app to TownMart's own database through the pooler", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("AUTH_SECRET", "x".repeat(40));
    vi.stubEnv("DATABASE_URL", "postgresql://neondb_owner:secret@ep-1-pooler.neon.tech/neondb?sslmode=require");
    delete process.env.MIGRATE_DATABASE_URL;
    expect(databaseRoles()).toBe("auto");
    const u = new URL(appDatabaseUrl()!);
    expect(u.username).toBe("townmart_app");
    expect(u.password).toBe(autoRolePassword("townmart_app"));
    expect(u.pathname).toBe("/townmart");
    expect(u.searchParams.get("pgbouncer")).toBe("true");
    expect(autoRolePassword("townmart_app")).not.toBe(autoRolePassword("townmart_migrator"));
    expect(new URL(asRole("postgresql://o:p@h/db", "townmart_migrator", { pooled: false })).searchParams.get("pgbouncer")).toBeNull();
  });

  it("uses DATABASE_URL as given when roles are manual", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("MIGRATE_DATABASE_URL", "postgresql://m@h/db");
    vi.stubEnv("DATABASE_URL", "postgresql://a@h/db");
    expect(databaseRoles()).toBe("manual");
    expect(appDatabaseUrl()).toBe("postgresql://a@h/db");
  });
});

describe("test mode", () => {
  const base = { NODE_ENV: "production", STORAGE_DRIVER: "s3", SMS_PROVIDER: "outbox", EMAIL_PROVIDER: "outbox", BANK_VERIFIER: "fake", PAYMENT_PROVIDER: "fake" } as Env;

  it("fills in the pretend drivers and keys", () => {
    vi.stubEnv("TOWNMART_TEST_MODE", "true");
    vi.stubEnv("AUTH_SECRET", "y".repeat(40));
    const e = withPlatformDefaults({ ...process.env, PAYMENT_PROVIDER: undefined, DATA_ENCRYPTION_KEY: undefined });
    expect(e.PAYMENT_PROVIDER).toBe("fake");
    expect(e.EMAIL_PROVIDER ?? "outbox").toBeTruthy();
    expect(Buffer.from(e.DATA_ENCRYPTION_KEY!, "base64")).toHaveLength(32);
  });

  it("allows the pretend drivers in production only on a test-mode site", () => {
    expect(productionProblems({ ...base, TOWNMART_TEST_MODE: true })).toEqual([]);
    expect(productionProblems({ ...base, TOWNMART_TEST_MODE: false })[0]).toMatch(/PAYMENT_PROVIDER=fake/);
    expect(productionProblems({ ...base, TOWNMART_TEST_MODE: true, STORAGE_DRIVER: "local" })[0]).toMatch(/STORAGE_DRIVER=local/);
  });

  it("refuses payment test keys on the live site", () => {
    const live = { NODE_ENV: "production", STORAGE_DRIVER: "s3", SMS_PROVIDER: "termii", EMAIL_PROVIDER: "resend", BANK_VERIFIER: "paystack", PAYMENT_PROVIDER: "flutterwave", TOWNMART_TEST_MODE: false } as Env;
    expect(productionProblems({ ...live, FLUTTERWAVE_SECRET_KEY: "FLWSECK-abc-X" })).toEqual([]);
    expect(productionProblems({ ...live, FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-abc-X" })[0]).toMatch(/FLUTTERWAVE_SECRET_KEY/);
    expect(productionProblems({ ...live, PAYSTACK_SECRET_KEY: "sk_test_abc" })[0]).toMatch(/PAYSTACK_SECRET_KEY/);
    expect(productionProblems({ ...live, TOWNMART_TEST_MODE: true, FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-abc-X" })).toEqual([]);
  });

  it("reads data keys as base64 or 64 hex characters", () => {
    const raw = Buffer.alloc(32, 7);
    expect(keyBytes(raw.toString("base64"))).toEqual(raw);
    expect(keyBytes(raw.toString("hex"))).toEqual(raw);
    expect(keyBytes(` ${raw.toString("hex")}\n`)).toEqual(raw);
  });

  it("puts the test password on a test site and the pre-launch password on the live site", () => {
    vi.stubEnv("TEST_SITE_PASSWORD", "test-pass");
    vi.stubEnv("PRELAUNCH_PASSWORD", "soon-pass");
    vi.stubEnv("TOWNMART_TEST_MODE", "true");
    expect(testSitePassword()).toBe("test-pass");
    vi.stubEnv("TOWNMART_TEST_MODE", "false");
    expect(testSitePassword()).toBe("soon-pass");
    vi.stubEnv("PRELAUNCH_PASSWORD", "");
    expect(testSitePassword()).toBeUndefined();
  });
});
