import "server-only";
import type { BusinessStatus, KycStatus } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { withRls } from "@/lib/db";
import { maskPhone } from "@/lib/phone";

export const ONBOARDING_STEPS = ["details", "phone", "identity", "payout", "branding", "submit"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const STEP_LABELS: Record<OnboardingStep, string> = {
  details: "Business details",
  phone: "Verify phone",
  identity: "Identity documents",
  payout: "Payout account",
  branding: "Store branding",
  submit: "Agreements & submit",
};

/** Statuses where the seller can still change their application. */
export const EDITABLE_STATUSES: readonly BusinessStatus[] = ["draft", "rejected"];

export type OnboardingState = {
  business: {
    id: string;
    name: string;
    slug: string;
    type: string;
    status: BusinessStatus;
    rejectionReason: string | null;
    description: string | null;
    cacNumber: string | null;
    email: string;
    phoneMasked: string;
    phone: string;
    addressLine: string;
    city: string;
    stateId: number;
    lgaId: number;
    sellsProducts: boolean;
    sellsServices: boolean;
    phoneVerified: boolean;
    logoKey: string | null;
    bannerKey: string | null;
    agreementsAccepted: boolean;
  } | null;
  kyc: { status: KycStatus; documentCount: number; notes: string | null } | null;
  payout: { bankName: string; accountName: string; last4: string } | null;
  done: Record<OnboardingStep, boolean>;
};

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const b = await withRls({ userId }, (tx) =>
    tx.business.findFirst({
      where: { ownerUserId: userId },
    }),
  );
  if (!b) {
    return {
      business: null,
      kyc: null,
      payout: null,
      done: { details: false, phone: false, identity: false, payout: false, branding: false, submit: false },
    };
  }
  // KYC rows and payout accounts are tenant-scoped, so re-read them with the business context.
  const [kyc, payout] = await withRls({ userId, businessId: b.id }, async (tx) => [
    await tx.businessKyc.findUnique({ where: { businessId: b.id } }),
    await tx.payoutAccount.findUnique({ where: { businessId: b.id } }),
  ] as const);
  const phone = decrypt(b.phoneEncrypted);
  const kycSubmitted = !!kyc && kyc.verificationStatus !== "not_submitted" && kyc.verificationStatus !== "failed";
  return {
    business: {
      id: b.id,
      name: b.name,
      slug: b.slug,
      type: b.type,
      status: b.status,
      rejectionReason: b.rejectionReason,
      description: b.description,
      cacNumber: b.cacNumber,
      email: b.email,
      phone,
      phoneMasked: maskPhone(phone),
      addressLine: decrypt(b.addressEncrypted),
      city: b.city,
      stateId: b.stateId,
      lgaId: b.lgaId,
      sellsProducts: b.sellsProducts,
      sellsServices: b.sellsServices,
      phoneVerified: !!b.phoneVerifiedAt,
      logoKey: b.logoKey,
      bannerKey: b.bannerKey,
      agreementsAccepted: !!b.sellerAgreementAcceptedAt && !!b.dpaAcceptedAt,
    },
    kyc: kyc ? { status: kyc.verificationStatus, documentCount: kyc.documentKeys.length, notes: kyc.notes } : null,
    payout: payout ? { bankName: payout.bankName, accountName: payout.accountName, last4: payout.accountNumberLast4 } : null,
    done: {
      details: true,
      phone: !!b.phoneVerifiedAt,
      identity: kycSubmitted,
      payout: !!payout?.verifiedAt,
      // Branding is optional beyond the description, which the storefront needs.
      branding: !!b.description,
      submit: !EDITABLE_STATUSES.includes(b.status),
    },
  };
}

/** The first step that isn't done, or "submit" once everything else is. */
export function nextStep(done: OnboardingState["done"]): OnboardingStep {
  return ONBOARDING_STEPS.find((s) => !done[s]) ?? "submit";
}
