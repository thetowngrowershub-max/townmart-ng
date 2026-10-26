import { z } from "zod";
import { emailSchema } from "./auth";
import { nigerianPhone, otpCode } from "./common";

const businessTypes = ["retailer", "supermarket", "vendor", "merchant", "producer", "service_provider", "artisan"] as const;

export const businessDetailsSchema = z
  .object({
    type: z.enum(businessTypes, { error: "Choose your business type" }),
    name: z.string().trim().min(2, "Enter your business name").max(80),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "At least 3 characters")
      .max(40)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens"),
    cacNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^(RC|BN|IT)?\s?\d{4,8}$/, "Enter a CAC number like RC 1234567 or BN 123456")
      .optional()
      .or(z.literal("")),
    email: emailSchema,
    phone: nigerianPhone,
    addressLine: z.string().trim().min(5, "Enter the street address").max(200),
    city: z.string().trim().min(2, "Enter the town or city").max(60),
    stateId: z.coerce.number().int().positive({ error: "Choose a state" }),
    lgaId: z.coerce.number().int().positive({ error: "Choose an LGA" }),
    sellsProducts: z.boolean(),
    sellsServices: z.boolean(),
  })
  .refine((v) => v.sellsProducts || v.sellsServices, { path: ["sellsProducts"], message: "Choose products, services or both" })
  .refine((v) => ["service_provider", "artisan"].includes(v.type) || v.cacNumber, {
    path: ["cacNumber"],
    message: "A CAC number is required for this business type",
  });
export type BusinessDetailsInput = z.input<typeof businessDetailsSchema>;

export const verifyPhoneSchema = z.object({ code: otpCode });

export const kycSchema = z.object({
  idDocumentType: z.enum(["nin_slip", "drivers_licence", "intl_passport", "voters_card", "cac_certificate"], {
    error: "Choose a document type",
  }),
  tmpKeys: z.array(z.string().min(10).max(200)).min(1, "Upload at least one document").max(3),
});
export type KycInput = z.input<typeof kycSchema>;

export const payoutAccountSchema = z.object({
  bankCode: z.string().trim().min(3, "Choose your bank").max(10),
  accountNumber: z.string().trim().regex(/^\d{10}$/, "Enter your 10-digit NUBAN account number"),
});
export type PayoutAccountInput = z.input<typeof payoutAccountSchema>;

export const agreementsSchema = z.object({
  acceptSellerAgreement: z.literal(true, { error: "You must accept the Seller Agreement" }),
  acceptDpa: z.literal(true, { error: "You must accept the Data Processing Agreement" }),
});

export const storeSettingsSchema = z.object({
  returnWindowDays: z.coerce.number().int().min(0).max(90),
  acceptsPayOnDelivery: z.boolean(),
  offersDelivery: z.boolean(),
  offersPickup: z.boolean(),
  deliveryNotes: z.string().trim().max(300).optional(),
  pickupAddress: z.string().trim().max(200).optional(),
});
export type StoreSettingsInput = z.input<typeof storeSettingsSchema>;

export const reviewDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ businessId: z.uuid(), decision: z.literal("start_review") }),
  z.object({ businessId: z.uuid(), decision: z.literal("approve") }),
  z.object({ businessId: z.uuid(), decision: z.literal("reject"), reason: z.string().trim().min(10, "Explain what the seller must fix").max(500) }),
  z.object({ businessId: z.uuid(), decision: z.literal("suspend"), reason: z.string().trim().min(10).max(500) }),
  z.object({ businessId: z.uuid(), decision: z.literal("kyc_verified") }),
  z.object({ businessId: z.uuid(), decision: z.literal("kyc_failed"), reason: z.string().trim().min(10).max(500) }),
]);
export type ReviewDecisionInput = z.input<typeof reviewDecisionSchema>;

export const brandingSchema = z.object({
  description: z.string().trim().min(30, "Tell shoppers about your business in at least 30 characters").max(1000),
  logoKey: z.string().max(200).optional().or(z.literal("")),
  bannerKey: z.string().max(200).optional().or(z.literal("")),
});
export type BrandingInput = z.input<typeof brandingSchema>;
