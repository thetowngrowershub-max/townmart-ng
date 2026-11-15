import { z } from "zod";
import { appDatabaseUrl, derivedKey, isTestMode, jobsInline, platformAppUrl, platformRedisUrl } from "@/lib/platform";

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  DATABASE_URL: z.string().min(1),
  MIGRATE_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  AUTH_SECRET: z.string().min(32),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  DATA_ENCRYPTION_KEY: base64Key,
  DATA_ENCRYPTION_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/).default("k1"),
  DATA_HASH_KEY: base64Key,
  // "outbox" keeps emails in the on-site test inbox (/test-inbox) instead of sending them; test mode only.
  EMAIL_PROVIDER: z.enum(["smtp", "resend", "outbox"]).default("smtp"),
  EMAIL_FROM: z.string().default("TownMart <no-reply@townmart.local>"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(1025),
  RESEND_API_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),

  // Optional analytics and advertising scripts, loaded only for visitors who allow them.
  ANALYTICS_SCRIPT_URL: z.url().optional().or(z.literal("").transform(() => undefined)),
  MARKETING_SCRIPT_URL: z.url().optional().or(z.literal("").transform(() => undefined)),

  // Object storage: "s3" (MinIO/R2/S3) or "local" (files on disk; development and tests only)
  STORAGE_DRIVER: z.enum(["s3", "local"]).default("s3"),
  LOCAL_STORAGE_DIR: z.string().default(".storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  S3_PUBLIC_BUCKET: z.string().default("townmart-public"),
  S3_PRIVATE_BUCKET: z.string().default("townmart-private"),
  S3_PUBLIC_BASE_URL: z.string().optional(),

  // SMS: "termii", "console" (logs messages; development only) or "outbox" (the test inbox; test mode only)
  SMS_PROVIDER: z.enum(["termii", "console", "outbox"]).default("console"),
  TERMII_API_KEY: z.string().optional(),
  TERMII_SENDER_ID: z.string().default("TownMart"),
  TERMII_BASE_URL: z.url().default("https://api.ng.termii.com"),

  // Bank account verification and payout subaccounts: "paystack" or "fake" (development only)
  BANK_VERIFIER: z.enum(["paystack", "fake"]).default("paystack"),
  PAYSTACK_SECRET_KEY: z.string().optional(),

  // Card/transfer/USSD payments: "paystack", "flutterwave", or "fake" (a local
  // stand-in payment page; development only). The fallback is tried when the
  // primary can't start a payment.
  PAYMENT_PROVIDER: z.enum(["paystack", "flutterwave", "fake"]).default("paystack"),
  PAYMENT_FALLBACK_PROVIDER: z.enum(["paystack", "flutterwave", "none"]).default("none"),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  // The "secret hash" set on the Flutterwave dashboard, sent back in the verif-hash header.
  FLUTTERWAVE_WEBHOOK_HASH: z.string().optional(),

  // A staging site for clicking through (see lib/platform.ts). Fills in the pretend drivers below.
  TOWNMART_TEST_MODE: z.stringbool().default(false),
  // Run background jobs in the web process (hosts without a worker). Defaults to on for Vercel.
  JOBS_INLINE: z.stringbool().default(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Validated server environment. Read lazily so that `next build` and unit tests
 * don't need every variable; the first real use fails loudly if one is missing.
 */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(withPlatformDefaults(process.env));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid environment variables:\n${issues}`);
    }
    const problems = productionProblems(parsed.data);
    if (problems.length) throw new Error(problems.join("\n"));
    cached = parsed.data;
  }
  return cached;
}

/**
 * Values the host provides under other names (Vercel), and the pretend drivers
 * that test mode stands for. Anything set explicitly wins.
 */
export function withPlatformDefaults(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = { ...source };
  e.APP_URL ??= platformAppUrl();
  e.REDIS_URL ??= platformRedisUrl();
  e.DATABASE_URL = appDatabaseUrl() ?? e.DATABASE_URL;
  e.JOBS_INLINE = String(jobsInline());
  if (isTestMode()) {
    e.PAYMENT_PROVIDER ??= "fake";
    e.BANK_VERIFIER ??= "fake";
    e.SMS_PROVIDER ??= "outbox";
    e.EMAIL_PROVIDER ??= "outbox";
    e.DATA_ENCRYPTION_KEY ??= derivedKey("data-encryption");
    e.DATA_HASH_KEY ??= derivedKey("data-hash");
  }
  return e;
}

/** Drivers a live site must not use. Test mode allows the pretend ones; files on local disk never work in production. */
export function productionProblems(e: Env): string[] {
  if (e.NODE_ENV !== "production") return [];
  const devOnly = [
    e.STORAGE_DRIVER === "local" && "STORAGE_DRIVER=local",
    ...(e.TOWNMART_TEST_MODE
      ? []
      : [
          e.SMS_PROVIDER === "console" && "SMS_PROVIDER=console",
          e.SMS_PROVIDER === "outbox" && "SMS_PROVIDER=outbox",
          e.EMAIL_PROVIDER === "outbox" && "EMAIL_PROVIDER=outbox",
          e.BANK_VERIFIER === "fake" && "BANK_VERIFIER=fake",
          e.PAYMENT_PROVIDER === "fake" && "PAYMENT_PROVIDER=fake",
        ]),
  ].filter(Boolean);
  return devOnly.length ? [`Development-only drivers are not allowed in production: ${devOnly.join(", ")}`] : [];
}

/**
 * The pretend payment page and fake bank checks: development, or a test-mode
 * site. Reads the validated runtime environment, because Next.js bakes a
 * literal process.env.NODE_ENV into the build.
 */
export const devDriversAllowed = () => env().NODE_ENV !== "production" || env().TOWNMART_TEST_MODE;

export const isProduction = () => process.env.NODE_ENV === "production";
