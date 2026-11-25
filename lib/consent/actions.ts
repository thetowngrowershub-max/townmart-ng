"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withSystemContext } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import type { ActionResult } from "@/lib/validation/form-result";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_DAYS, serialiseConsent } from "./cookie";
import { cookiePolicyVersion, readConsent } from "./server";

const consentSchema = z.object({
  functional: z.boolean(),
  analytics: z.boolean(),
  marketing: z.boolean(),
  source: z.enum(["banner", "settings", "privacy_centre"]),
});

/** Saves a cookie choice: logs it (proof of consent) and sets the consent cookie. */
export async function saveConsentAction(input: z.input<typeof consentSchema>): Promise<ActionResult> {
  const parsed = consentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something went wrong. Please try again." };
  const meta = await requestMeta();
  if (!(await rateLimit(`consent:${meta.ipHash}`, 30, 600)).allowed) return { ok: false, error: "Too many changes. Please wait a few minutes." };

  const { source, ...choices } = parsed.data;
  const [existing, user, version] = await Promise.all([readConsent(), getCurrentUser(), cookiePolicyVersion()]);
  const subjectId = existing?.subjectId ?? randomUUID();
  const at = new Date();
  try {
    await withSystemContext((tx) =>
      tx.consentRecord.createMany({
        data: { subjectId, userId: user?.id ?? null, ...choices, policyVersion: version ?? "unpublished", source, ipHash: meta.ipHash, userAgent: meta.userAgent },
      }),
    );
  } catch (err) {
    logger.error({ err }, "saving cookie consent failed");
    return { ok: false, error: "We couldn't save your choice. Please try again." };
  }
  (await cookies()).set(CONSENT_COOKIE, serialiseConsent({ subjectId, ...choices, version: version ?? "unpublished", at }), {
    httpOnly: true,
    sameSite: "lax",
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: CONSENT_MAX_AGE_DAYS * 86_400,
  });
  return { ok: true };
}
