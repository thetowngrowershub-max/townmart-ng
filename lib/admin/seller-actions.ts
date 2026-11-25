"use server";

import type { BusinessStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { assertCan, AuthzError } from "@/lib/authz";
import { withRls } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sellerDecisionTemplate } from "@/lib/notifications/email/templates";
import { enqueueEmail } from "@/lib/queue";
import { requestMeta } from "@/lib/request";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { reviewDecisionSchema, type ReviewDecisionInput } from "@/lib/validation/seller";

/** Which statuses each decision may move a business out of. */
const FROM: Record<"start_review" | "approve" | "reject" | "suspend", readonly BusinessStatus[]> = {
  start_review: ["pending"],
  approve: ["pending", "under_review", "suspended"],
  reject: ["pending", "under_review"],
  suspend: ["approved"],
};

class ReviewError extends Error {}

export async function reviewSellerAction(input: ReviewDecisionInput): Promise<ActionResult> {
  const actor = await getCurrentUser();
  try {
    assertCan(actor, "seller.review");
  } catch (err) {
    return { ok: false, error: (err as AuthzError).message };
  }
  const parsed = reviewDecisionSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const d = parsed.data;
  const meta = await requestMeta();

  let email: Parameters<typeof sellerDecisionTemplate>[0] | null = null;
  try {
    await withRls({ scope: "admin", userId: actor.id }, async (tx) => {
      const b = await tx.business.findUnique({
        where: { id: d.businessId },
        include: { kyc: true, payoutAccount: { select: { verifiedAt: true } } },
      });
      if (!b) throw new ReviewError("Seller not found.");
      const audit = (action: string, before: unknown, after: unknown) =>
        writeAudit(tx, { actorUserId: actor.id, actorRole: actor.roles.includes("super_admin") ? "super_admin" : "admin", action, entityType: "business", entityId: b.id, before, after, ipHash: meta.ipHash });

      if (d.decision === "kyc_verified" || d.decision === "kyc_failed") {
        if (!b.kyc || b.kyc.verificationStatus === "not_submitted") throw new ReviewError("No documents have been submitted.");
        const verified = d.decision === "kyc_verified";
        await tx.businessKyc.update({
          where: { businessId: b.id },
          data: {
            verificationStatus: verified ? "verified" : "failed",
            verifiedAt: verified ? new Date() : null,
            reviewedBy: actor.id,
            notes: verified ? null : d.reason,
          },
        });
        await audit(`kyc.${verified ? "verified" : "failed"}`, { status: b.kyc.verificationStatus }, { status: verified ? "verified" : "failed", reason: verified ? undefined : d.reason });
        return;
      }

      if (!FROM[d.decision].includes(b.status)) throw new ReviewError(`Can't ${d.decision.replace("_", " ")} a seller that is ${b.status.replace("_", " ")}.`);
      if (d.decision === "approve") {
        if (b.kyc?.verificationStatus !== "verified") throw new ReviewError("Verify the identity documents first.");
        if (!b.payoutAccount?.verifiedAt) throw new ReviewError("The seller has no verified payout account.");
        if (!b.phoneVerifiedAt) throw new ReviewError("The seller hasn't verified their phone.");
      }
      const status: BusinessStatus = { start_review: "under_review", approve: "approved", reject: "rejected", suspend: "suspended" }[d.decision] as BusinessStatus;
      const reason = "reason" in d ? d.reason : null;
      await tx.business.update({
        where: { id: b.id },
        data: {
          status,
          reviewedAt: new Date(),
          reviewedBy: actor.id,
          rejectionReason: d.decision === "reject" || d.decision === "suspend" ? reason : null,
        },
      });
      await audit(`business.${d.decision}`, { status: b.status }, { status, reason: reason ?? undefined });
      if (status === "approved" || status === "rejected" || status === "suspended") {
        email = {
          to: b.email,
          businessName: b.name,
          decision: status,
          reason: reason ?? undefined,
          url: new URL(status === "rejected" ? "/sell/onboarding" : "/dashboard", env().APP_URL).toString(),
        };
      }
    });
  } catch (err) {
    if (err instanceof ReviewError) return { ok: false, error: err.message };
    logger.error({ err }, "seller review failed");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  if (email) await enqueueEmail(sellerDecisionTemplate(email));
  revalidatePath("/admin/sellers");
  revalidatePath(`/admin/sellers/${d.businessId}`);
  return { ok: true, message: "Saved." };
}
