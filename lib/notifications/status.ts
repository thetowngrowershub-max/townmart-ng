import { env } from "@/lib/env";

/**
 * Which text-message and email services are switched on, and what each still
 * needs, in words an owner can act on. Shown on the admin system page and a
 * test site's /api/health.
 */
export type ServiceStatus = {
  provider: string;
  /** True when messages leave the site (not the test inbox or a log). */
  live: boolean;
  /** Settings the chosen service still needs. Empty when ready. */
  missing: string[];
  detail: string;
};

export function smsStatus(): ServiceStatus {
  const e = env();
  if (e.SMS_PROVIDER === "termii") {
    return {
      provider: "termii",
      live: true,
      missing: e.TERMII_API_KEY ? [] : ["TERMII_API_KEY"],
      detail: `Termii, sender ID "${e.TERMII_SENDER_ID}", ${e.TERMII_CHANNEL === "dnd" ? "DND route" : "generic route (numbers on Do-Not-Disturb won't get texts)"}, ${e.TERMII_BASE_URL}`,
    };
  }
  if (e.SMS_PROVIDER === "outbox") return { provider: "outbox", live: false, missing: [], detail: "Test inbox: texts are kept on the site at /test-inbox, not sent" };
  return { provider: "console", live: false, missing: [], detail: "Development: texts are written to the server log, not sent" };
}

export function emailStatus(): ServiceStatus {
  const e = env();
  if (e.EMAIL_PROVIDER === "resend") {
    return { provider: "resend", live: true, missing: e.RESEND_API_KEY ? [] : ["RESEND_API_KEY"], detail: `Resend, from ${e.EMAIL_FROM}` };
  }
  if (e.EMAIL_PROVIDER === "outbox") return { provider: "outbox", live: false, missing: [], detail: "Test inbox: emails are kept on the site at /test-inbox, not sent" };
  return { provider: "smtp", live: true, missing: [], detail: `SMTP server ${e.SMTP_HOST}:${e.SMTP_PORT}, from ${e.EMAIL_FROM}` };
}
