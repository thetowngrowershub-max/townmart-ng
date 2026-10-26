"use server";

import { Prisma, type BusinessStatus, type Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { assertCan, AuthzError } from "@/lib/authz";
import { RESERVED_STORE_SLUGS } from "@/lib/catalogue/slug";
import { decrypt, encrypt, phoneHash } from "@/lib/crypto";
import { withRls, withSystemContext, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { DPA_VERSION, SELLER_AGREEMENT_VERSION } from "@/lib/legal";
import { logger } from "@/lib/logger";
import { sellerSubmittedTemplate } from "@/lib/notifications/email/templates";
import { issueOtp, verifyOtp } from "@/lib/otp";
import { bankVerifier } from "@/lib/payments/banks";
import { enqueueEmail } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { storage } from "@/lib/storage";
import { finaliseDocument, imagePrefix, UploadError } from "@/lib/storage/uploads";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import {
  agreementsSchema,
  brandingSchema,
  businessDetailsSchema,
  kycSchema,
  payoutAccountSchema,
  storeSettingsSchema,
  verifyPhoneSchema,
  type BrandingInput,
  type BusinessDetailsInput,
  type KycInput,
  type PayoutAccountInput,
  type StoreSettingsInput,
} from "@/lib/validation/seller";
import { EDITABLE_STATUSES, getOnboardingState } from "./onboarding";

const NOT_EDITABLE = "Your application is with our team. You can make changes if we ask for them.";
const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

/** A problem the seller can fix; its message is safe to show. */
class SellerError extends Error {}

type OwnBusiness = { userId: string; business: { id: string; name: string; status: BusinessStatus; email: string } };

/** The signed-in owner's own business, after the app-layer authz check. */
async function ownBusiness(): Promise<OwnBusiness> {
  const user = await getCurrentUser();
  assertCan(user, "seller.onboard");
  const business = await withRls({ userId: user.id }, (tx) =>
    tx.business.findFirst({ where: { ownerUserId: user.id }, select: { id: true, name: true, status: true, email: true } }),
  );
  if (!business) throw new SellerError("Start with your business details.");
  assertCan({ ...user, businesses: [{ id: business.id, role: "owner" }] }, "store.manage", { businessId: business.id });
  return { userId: user.id, business };
}

/** Runs `fn` in an RLS transaction scoped to the owner's business. Keep network calls out of `fn`. */
async function withOwnBusiness<T>(fn: (ctx: OwnBusiness & { tx: Tx }) => Promise<T>, own?: OwnBusiness): Promise<T> {
  const o = own ?? (await ownBusiness());
  return withRls({ userId: o.userId, businessId: o.business.id }, (tx) => fn({ ...o, tx }));
}

function assertEditable(status: BusinessStatus) {
  if (!EDITABLE_STATUSES.includes(status)) throw new SellerError(NOT_EDITABLE);
}

function failure(err: unknown, fallback = "Something went wrong. Please try again."): ActionResult<never> {
  if (err instanceof AuthzError || err instanceof UploadError || err instanceof SellerError) return { ok: false, error: err.message };
  logger.error({ err }, "seller onboarding action failed");
  return { ok: false, error: fallback };
}

// ─── Step 1: business details ───────────────────────────────────────────────

export async function saveBusinessDetailsAction(input: BusinessDetailsInput): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.emailVerified) return { ok: false, error: "Please confirm your email address before you start selling." };
  try {
    assertCan(user, "seller.onboard");
  } catch (err) {
    return failure(err);
  }
  const parsed = businessDetailsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const d = parsed.data;
  if (RESERVED_STORE_SLUGS.has(d.slug)) return { ok: false, error: "That store address is reserved.", fieldErrors: { slug: ["Choose another address"] } };

  const lga = await withRls({ userId: user.id }, (tx) => tx.lga.findUnique({ where: { id: d.lgaId }, select: { stateId: true } }));
  if (!lga || lga.stateId !== d.stateId) return { ok: false, error: "Choose an LGA in the selected state.", fieldErrors: { lgaId: ["Not in this state"] } };

  const meta = await requestMeta();
  const fields = {
    type: d.type,
    name: d.name,
    slug: d.slug,
    cacNumber: d.cacNumber || null,
    email: d.email,
    phoneEncrypted: encrypt(d.phone),
    phoneHash: phoneHash(d.phone),
    addressEncrypted: encrypt(d.addressLine),
    city: d.city,
    stateId: d.stateId,
    lgaId: d.lgaId,
    sellsProducts: d.sellsProducts,
    sellsServices: d.sellsServices,
  };

  try {
    await withRls({ userId: user.id }, async (tx) => {
      const existing = await tx.business.findFirst({ where: { ownerUserId: user.id }, select: { id: true, status: true, phoneHash: true } });
      if (existing) {
        assertEditable(existing.status);
        await tx.$executeRaw`SELECT set_config('app.current_business_id', ${existing.id}, true)`;
        await tx.business.update({
          where: { id: existing.id },
          // A new number has to be verified again.
          data: { ...fields, ...(existing.phoneHash !== fields.phoneHash ? { phoneVerifiedAt: null } : {}) },
        });
        await writeAudit(tx, { actorUserId: user.id, action: "business.updated", entityType: "business", entityId: existing.id, ipHash: meta.ipHash });
        return;
      }
      const created = await tx.business.create({ data: { ...fields, ownerUserId: user.id }, select: { id: true } });
      // Child rows are tenant-scoped: switch this transaction to the new business.
      await tx.$executeRaw`SELECT set_config('app.current_business_id', ${created.id}, true)`;
      await tx.storePolicy.create({ data: { businessId: created.id } });
      await tx.businessKyc.create({ data: { businessId: created.id } });
      await writeAudit(tx, { actorUserId: user.id, action: "business.created", entityType: "business", entityId: created.id, after: { name: d.name, type: d.type }, ipHash: meta.ipHash });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "That store address is taken.", fieldErrors: { slug: ["Already taken, try another"] } };
    }
    return failure(err);
  }

  // Seller roles unlock the dashboard. Granting roles is privileged, so it runs as system.
  const roles: Role[] = [...(d.sellsProducts ? (["merchant"] as const) : []), ...(d.sellsServices ? (["service_provider"] as const) : [])];
  await withSystemContext(async (tx) => {
    await tx.userRole.createMany({ data: roles.map((role) => ({ userId: user.id, role })), skipDuplicates: true });
    await writeAudit(tx, { actorUserId: user.id, action: "user.roles.granted", entityType: "user", entityId: user.id, after: { roles, reason: "seller_onboarding" } });
  });

  revalidatePath("/sell/onboarding");
  return { ok: true };
}

// ─── Step 2: verify the business phone ──────────────────────────────────────

export async function sendBusinessPhoneCodeAction(): Promise<ActionResult> {
  try {
    return await withOwnBusiness(async ({ tx, business }) => {
      const row = await tx.business.findUniqueOrThrow({ where: { id: business.id }, select: { phoneEncrypted: true, phoneHash: true } });
      const res = await issueOtp({ phoneE164: decrypt(row.phoneEncrypted), phoneHash: row.phoneHash, purpose: "verify_business_phone" });
      return res.ok ? { ok: true, message: "Code sent. It expires in 10 minutes." } : res;
    });
  } catch (err) {
    return failure(err);
  }
}

export async function verifyBusinessPhoneAction(input: { code: string }): Promise<ActionResult> {
  const parsed = verifyPhoneSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const res = await withOwnBusiness(async ({ tx, business, userId }) => {
      const row = await tx.business.findUniqueOrThrow({ where: { id: business.id }, select: { phoneHash: true } });
      const check = await verifyOtp({ phoneHash: row.phoneHash, purpose: "verify_business_phone", code: parsed.data.code });
      if (!check.ok) return check;
      await tx.business.update({ where: { id: business.id }, data: { phoneVerifiedAt: new Date() } });
      await writeAudit(tx, { actorUserId: userId, action: "business.phone_verified", entityType: "business", entityId: business.id });
      return { ok: true } as const;
    });
    if (!res.ok) return { ok: false, error: res.error, fieldErrors: { code: [res.error] } };
    revalidatePath("/sell/onboarding");
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

// ─── Step 3: identity documents ─────────────────────────────────────────────

export async function submitKycAction(input: KycInput): Promise<ActionResult> {
  const parsed = kycSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const own = await ownBusiness();
    assertEditable(own.business.status);
    const docs: { key: string }[] = [];
    for (const key of parsed.data.tmpKeys) docs.push(await finaliseDocument(own.business.id, key));
    const previous = await withOwnBusiness(async ({ tx, business, userId }) => {
      const prev = await tx.businessKyc.findUnique({ where: { businessId: business.id }, select: { documentKeys: true } });
      const data = { idDocumentType: parsed.data.idDocumentType, documentKeys: docs.map((d) => d.key), verificationStatus: "pending" as const };
      await tx.businessKyc.upsert({ where: { businessId: business.id }, create: { ...data, businessId: business.id }, update: { ...data, notes: null } });
      await writeAudit(tx, {
        actorUserId: userId,
        action: "kyc.submitted",
        entityType: "business",
        entityId: business.id,
        after: { idDocumentType: parsed.data.idDocumentType, documents: docs.length },
      });
      return prev?.documentKeys ?? [];
    }, own);
    // Replaced documents are deleted, not kept around.
    for (const key of previous) await storage().deleteObject("private", key).catch(() => undefined);
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/sell/onboarding");
  return { ok: true };
}

// ─── Step 4: payout account ─────────────────────────────────────────────────

export async function resolveBankAccountAction(input: PayoutAccountInput): Promise<ActionResult<{ accountName: string }>> {
  const parsed = payoutAccountSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!(await rateLimit(`bank-resolve:${user.id}`, 10, 600)).allowed) return { ok: false, error: TOO_MANY };
  try {
    const res = await bankVerifier().resolveAccount(parsed.data.bankCode, parsed.data.accountNumber);
    if (!res) return { ok: false, error: "We couldn't find that account. Check the bank and number.", fieldErrors: { accountNumber: ["Account not found"] } };
    return { ok: true, data: res };
  } catch (err) {
    return failure(err, "We couldn't reach the bank right now. Please try again shortly.");
  }
}

export async function savePayoutAccountAction(input: PayoutAccountInput): Promise<ActionResult> {
  const parsed = payoutAccountSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { bankCode, accountNumber } = parsed.data;
  try {
    const own = await ownBusiness();
    if (!(await rateLimit(`bank-save:${own.business.id}`, 5, 3600)).allowed) throw new SellerError(TOO_MANY);
    const verifier = bankVerifier();
    // Resolve again on the server: never trust an account name sent by the browser.
    const resolved = await verifier.resolveAccount(bankCode, accountNumber);
    if (!resolved) throw new SellerError("We couldn't find that account. Check the bank and number.");
    const bank = (await verifier.listBanks()).find((b) => b.code === bankCode);
    if (!bank) throw new SellerError("Choose your bank from the list.");
    // Commission is set per split at checkout (Phase 3), so the subaccount's default charge is 0.
    const sub = await verifier.createSubaccount({ businessName: own.business.name, bankCode, accountNumber, percentageCharge: 0 });
    const recipient = await verifier.createTransferRecipient({ accountName: resolved.accountName, bankCode, accountNumber });
    // Only the last 4 digits are stored; the full number lives with the payment provider.
    const data = {
      bankCode,
      bankName: bank.name,
      accountNumberLast4: accountNumber.slice(-4),
      accountName: resolved.accountName,
      providerSubaccountCode: sub.subaccountCode,
      providerRecipientCode: recipient.recipientCode,
      verifiedAt: new Date(),
    };
    await withOwnBusiness(async ({ tx, business, userId }) => {
      await tx.payoutAccount.upsert({ where: { businessId: business.id }, create: { ...data, businessId: business.id }, update: data });
      await writeAudit(tx, {
        actorUserId: userId,
        action: "payout_account.saved",
        entityType: "business",
        entityId: business.id,
        after: { bankName: bank.name, last4: data.accountNumberLast4 },
      });
    }, own);
  } catch (err) {
    return failure(err, "We couldn't save your account right now. Please try again shortly.");
  }
  revalidatePath("/sell/onboarding");
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

// ─── Step 5: branding ───────────────────────────────────────────────────────

export async function saveBrandingAction(input: BrandingInput): Promise<ActionResult> {
  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { description, logoKey, bannerKey } = parsed.data;
  try {
    await withOwnBusiness(async ({ tx, business, userId }) => {
      if (logoKey && !logoKey.startsWith(imagePrefix("logo", business.id))) throw new SellerError("That logo isn't yours.");
      if (bannerKey && !bannerKey.startsWith(imagePrefix("banner", business.id))) throw new SellerError("That banner isn't yours.");
      const before = await tx.business.findUniqueOrThrow({ where: { id: business.id }, select: { logoKey: true, bannerKey: true } });
      await tx.business.update({ where: { id: business.id }, data: { description, logoKey: logoKey || null, bannerKey: bannerKey || null } });
      await writeAudit(tx, { actorUserId: userId, action: "business.branding_updated", entityType: "business", entityId: business.id });
      for (const old of [before.logoKey, before.bannerKey]) {
        if (old && old !== logoKey && old !== bannerKey) await storage().deleteObject("public", old).catch(() => undefined);
      }
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/sell/onboarding");
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

// ─── Step 6: agreements and submit ──────────────────────────────────────────

export async function submitApplicationAction(input: { acceptSellerAgreement: boolean; acceptDpa: boolean }): Promise<ActionResult> {
  const parsed = agreementsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const state = await getOnboardingState(user.id);
  if (!state.business) return { ok: false, error: "Start with your business details." };
  const missing = (["phone", "identity", "payout", "branding"] as const).filter((s) => !state.done[s]);
  if (missing.length) return { ok: false, error: "Finish every step before you submit." };

  const meta = await requestMeta();
  try {
    await withOwnBusiness(async ({ tx, business, userId }) => {
      assertEditable(business.status);
      const now = new Date();
      await tx.business.update({
        where: { id: business.id },
        data: {
          status: "pending",
          submittedAt: now,
          rejectionReason: null,
          sellerAgreementVersion: SELLER_AGREEMENT_VERSION,
          sellerAgreementAcceptedAt: now,
          dpaVersion: DPA_VERSION,
          dpaAcceptedAt: now,
        },
      });
      await writeAudit(tx, {
        actorUserId: userId,
        action: "business.submitted",
        entityType: "business",
        entityId: business.id,
        after: { sellerAgreementVersion: SELLER_AGREEMENT_VERSION, dpaVersion: DPA_VERSION },
        ipHash: meta.ipHash,
      });
    });
    await enqueueEmail(sellerSubmittedTemplate({ to: state.business.email, businessName: state.business.name, url: new URL("/dashboard", env().APP_URL).toString() }));
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/sell/onboarding");
  return { ok: true };
}

// ─── Store settings (any time after onboarding) ─────────────────────────────

export async function saveStoreSettingsAction(input: StoreSettingsInput): Promise<ActionResult> {
  const parsed = storeSettingsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const d = parsed.data;
  if (!d.offersDelivery && !d.offersPickup) return { ok: false, error: "Offer delivery, pickup or both.", fieldErrors: { offersDelivery: ["Choose at least one"] } };
  if (d.offersPickup && !d.pickupAddress) return { ok: false, error: "Add the pickup address.", fieldErrors: { pickupAddress: ["Required for pickup"] } };
  try {
    await withOwnBusiness(async ({ tx, business, userId }) => {
      const data = {
        returnWindowDays: d.returnWindowDays,
        acceptsPayOnDelivery: d.acceptsPayOnDelivery,
        deliveryOptions: { delivery: d.offersDelivery, pickup: d.offersPickup, notes: d.deliveryNotes ?? "" },
        pickupAddressEncrypted: d.offersPickup && d.pickupAddress ? encrypt(d.pickupAddress) : null,
      };
      await tx.storePolicy.upsert({ where: { businessId: business.id }, create: { ...data, businessId: business.id }, update: data });
      await writeAudit(tx, { actorUserId: userId, action: "store_policy.updated", entityType: "business", entityId: business.id, after: { ...data, pickupAddressEncrypted: undefined } });
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/dashboard/settings");
  return { ok: true, message: "Store policies saved." };
}
