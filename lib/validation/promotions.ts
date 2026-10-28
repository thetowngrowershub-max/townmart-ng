import { z } from "zod";
import { lagosDateTime, nairaAmount, optionalNairaAmount } from "./common";

export const DISCOUNT_TYPES = ["percentage", "fixed"] as const;
export const PROMOTION_SCOPES = ["product", "products", "category", "store", "service"] as const;

/** Flash deals are short by definition; longer sales are ordinary promotions. */
export const FLASH_DEAL_MAX_HOURS = 72;

const optionalCount = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!/^\d{1,7}$/.test(v) || Number(v) < 1) {
      ctx.addIssue({ code: "custom", message: "Enter a whole number, 1 or more, or leave it empty" });
      return z.NEVER;
    }
    return Number(v);
  });

export const promotionInputSchema = z
  .object({
    name: z.string().trim().min(2, "Give the promotion a name").max(80),
    description: z.string().trim().max(300).optional(),
    discountType: z.enum(DISCOUNT_TYPES),
    /** Whole percent, or naira for a fixed amount. Converted in superRefine/transform below. */
    discountValue: z.string().trim().min(1, "Enter the discount"),
    scope: z.enum(PROMOTION_SCOPES),
    productIds: z.array(z.uuid()).max(200).default([]),
    serviceIds: z.array(z.uuid()).max(100).default([]),
    categoryIds: z.array(z.uuid()).max(20).default([]),
    startsAt: lagosDateTime("Choose when it starts"),
    endsAt: lagosDateTime("Choose when it ends"),
    usageLimit: optionalCount,
    perCustomerLimit: optionalCount,
    minOrder: optionalNairaAmount,
    isFlashDeal: z.boolean().default(false),
    isActive: z.boolean().default(true),
    couponCode: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.toUpperCase() : null))
      .pipe(z.string().regex(/^[A-Z0-9-]{4,24}$/, "Use 4 to 24 letters, numbers or dashes").nullable()),
    allowsStacking: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    if (p.endsAt <= p.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Must be after the start" });
    if (p.isFlashDeal && p.endsAt.getTime() - p.startsAt.getTime() > FLASH_DEAL_MAX_HOURS * 3_600_000) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: `A flash deal can run for up to ${FLASH_DEAL_MAX_HOURS} hours` });
    }
    if (p.discountType === "percentage") {
      if (!/^\d{1,3}$/.test(p.discountValue) || Number(p.discountValue) < 1 || Number(p.discountValue) > 100) {
        ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Enter a whole percentage from 1 to 100" });
      }
    } else if (!nairaAmount.safeParse(p.discountValue).success || nairaAmount.parse(p.discountValue) <= 0n) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Enter an amount in naira, e.g. 500" });
    }
    const need = (field: "productIds" | "serviceIds" | "categoryIds", count: number, message: string) => {
      if (p[field].length < count) ctx.addIssue({ code: "custom", path: [field], message });
    };
    if (p.scope === "product") {
      need("productIds", 1, "Choose the product");
      if (p.productIds.length > 1) ctx.addIssue({ code: "custom", path: ["productIds"], message: "Choose one product, or use “Selected products”" });
    }
    if (p.scope === "products") need("productIds", 1, "Choose at least one product");
    if (p.scope === "service") need("serviceIds", 1, "Choose at least one service");
    if (p.scope === "category") need("categoryIds", 1, "Choose at least one category");
    if (p.allowsStacking && !p.couponCode) ctx.addIssue({ code: "custom", path: ["allowsStacking"], message: "Only a coupon can stack with other discounts" });
  })
  .transform((p) => ({
    ...p,
    discountValue: p.discountType === "percentage" ? BigInt(p.discountValue) : nairaAmount.parse(p.discountValue),
    // Only keep the targets the chosen scope uses.
    productIds: p.scope === "product" || p.scope === "products" ? p.productIds : [],
    serviceIds: p.scope === "service" ? p.serviceIds : [],
    categoryIds: p.scope === "category" ? p.categoryIds : [],
    minOrderKobo: p.minOrder ?? 0n,
  }));

export type PromotionInput = z.input<typeof promotionInputSchema>;
export type PromotionData = z.output<typeof promotionInputSchema>;

export const promotionIdSchema = z.uuid();
export const promotionChangeSchema = z.object({ id: promotionIdSchema, change: z.enum(["pause", "resume", "end"]) });
