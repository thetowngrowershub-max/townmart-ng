import { z } from "zod";

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
  EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("smtp"),
  EMAIL_FROM: z.string().default("TownMart <no-reply@townmart.local>"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().default(1025),
  RESEND_API_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),

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

  // SMS: "termii" or "console" (logs messages; development only)
  SMS_PROVIDER: z.enum(["termii", "console"]).default("console"),
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
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Validated server environment. Read lazily so that `next build` and unit tests
 * don't need every variable; the first real use fails loudly if one is missing.
 */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid environment variables:\n${issues}`);
    }
    if (parsed.data.NODE_ENV === "production") {
      const devOnly = [
        parsed.data.STORAGE_DRIVER === "local" && "STORAGE_DRIVER=local",
        parsed.data.SMS_PROVIDER === "console" && "SMS_PROVIDER=console",
        parsed.data.BANK_VERIFIER === "fake" && "BANK_VERIFIER=fake",
        parsed.data.PAYMENT_PROVIDER === "fake" && "PAYMENT_PROVIDER=fake",
      ].filter(Boolean);
      if (devOnly.length) throw new Error(`Development-only drivers are not allowed in production: ${devOnly.join(", ")}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProduction = () => process.env.NODE_ENV === "production";
