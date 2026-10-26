import { env, isProduction } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Verifies a Cloudflare Turnstile token server-side.
 * Without TURNSTILE_SECRET_KEY the check is skipped in development and fails
 * closed in production.
 */
export async function verifyTurnstile(token: string | undefined, ip?: string): Promise<boolean> {
  const secret = env().TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (isProduction()) {
      logger.error("TURNSTILE_SECRET_KEY is not set in production; rejecting request");
      return false;
    }
    return true;
  }
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "unknown") body.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    logger.error({ err }, "Turnstile verification failed");
    return false;
  }
}
