import { createHmac, timingSafeEqual } from "node:crypto";
import type { Tx } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Marketing consent is opt-in and separate from the terms: signed-in users
 * switch it on in their notification settings (or at checkout), guests by
 * ticking the box at checkout. Every message carries a one-click unsubscribe
 * link; unsubscribed addresses go on a suppression list and are never
 * contacted again, whatever else they ticked.
 */

const sign = (email: string) => createHmac("sha256", env().AUTH_SECRET).update(`unsubscribe:${email.toLowerCase()}`).digest("base64url");

/**
 * A link that unsubscribes this address without signing in; it doesn't
 * expire. "page" is the link in the email footer; "one-click" is the
 * List-Unsubscribe header URL that mail apps POST to (RFC 8058).
 */
export function unsubscribeUrl(email: string, kind: "page" | "one-click" = "page"): string {
  const url = new URL(kind === "page" ? "/unsubscribe" : "/api/unsubscribe", env().APP_URL);
  url.searchParams.set("e", Buffer.from(email.toLowerCase()).toString("base64url"));
  url.searchParams.set("t", sign(email));
  return url.toString();
}

/** The email address an unsubscribe link is for, or null if it was tampered with. */
export function verifyUnsubscribe(e: string | null | undefined, t: string | null | undefined): string | null {
  if (!e || !t) return null;
  const email = Buffer.from(e, "base64url").toString("utf8");
  if (!email.includes("@")) return null;
  const expected = Buffer.from(sign(email));
  const given = Buffer.from(t);
  return expected.length === given.length && timingSafeEqual(expected, given) ? email : null;
}

/** Stops all marketing to this address: suppression list, plus the account's preferences if there is one. */
export async function unsubscribe(tx: Tx, email: string, source: string): Promise<void> {
  await tx.marketingSuppression.upsert({ where: { email }, create: { email, source }, update: {} });
  const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    await tx.notificationPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, marketingEmail: false, marketingSms: false },
      update: { marketingEmail: false, marketingSms: false, marketingEmailAt: null },
    });
  }
}

/**
 * Who may be sent marketing email: active accounts that opted in, and guests
 * who ticked the box at checkout, less everyone who unsubscribed. Any
 * campaign must draw its list from here.
 */
export async function marketingAudience(tx: Tx): Promise<string[]> {
  const rows = await tx.$queryRaw<{ email: string }[]>`
    SELECT DISTINCT email::text AS email FROM (
      SELECT u.email FROM users u JOIN notification_preferences p ON p.user_id = u.id
       WHERE p.marketing_email AND u.status = 'active'
      UNION
      SELECT o.contact_email FROM orders o
       WHERE o.is_guest AND o.marketing_consent
    ) a
    WHERE NOT EXISTS (SELECT 1 FROM marketing_suppressions s WHERE s.email = a.email)
    ORDER BY 1`;
  return rows.map((r) => r.email);
}
