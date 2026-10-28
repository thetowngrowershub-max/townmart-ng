import { z } from "zod";
import { lagosLocalToDate } from "@/lib/datetime";
import { nairaAmount } from "./common";

/** Admin forms for categories, attributes, commission, delivery zones and platform settings. */

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .max(80)
  .regex(/^([a-z0-9]+(-[a-z0-9]+)*)?$/, "Use lowercase letters, numbers and single hyphens");

export const categorySchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Give the category a name").max(60),
  slug,
  kind: z.enum(["product", "service"]),
  parentId: z.union([z.uuid(), z.literal("").transform(() => null)]),
  icon: z.string().trim().max(40).regex(/^([a-z0-9-]+)?$/, "Use a Lucide icon name, e.g. shirt").optional().default(""),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  isActive: z.boolean(),
});
export type CategoryInput = z.input<typeof categorySchema>;

export const attributeSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(2, "Give the attribute a name").max(60),
    slug,
    type: z.enum(["text", "number", "select"]),
    options: z
      .string()
      .optional()
      .transform((v) => [...new Set((v ?? "").split(/\n|,/).map((s) => s.trim()).filter(Boolean))])
      .pipe(z.array(z.string().max(60, "Keep each option under 60 characters")).max(60, "Up to 60 options")),
  })
  .refine((a) => a.type !== "select" || a.options.length >= 2, { message: "A list needs at least two options", path: ["options"] });
export type AttributeInput = z.input<typeof attributeSchema>;

export const categoryAttributesSchema = z.object({
  categoryId: z.uuid(),
  items: z
    .array(z.object({ attributeId: z.uuid(), isRequired: z.boolean() }))
    .max(30, "Up to 30 attributes per category")
    .refine((items) => new Set(items.map((i) => i.attributeId)).size === items.length, "Each attribute can be added once"),
});

const percent = (max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a percentage, e.g. 5 or 7.5")
    .transform((v) => Math.round(Number(v) * 100))
    .refine((bps) => bps <= max * 100, `Keep it at or under ${max}%`);

export const commissionRuleSchema = z
  .object({
    scope: z.enum(["global", "category", "business"]),
    categoryId: z.union([z.uuid(), z.literal("").transform(() => null)]),
    businessId: z.union([z.uuid(), z.literal("").transform(() => null)]),
    percent: percent(50),
    fixed: z.union([nairaAmount, z.literal("").transform(() => 0n)]),
    effectiveFrom: z
      .string()
      .trim()
      .transform((v, ctx) => {
        if (!v) return null;
        const d = lagosLocalToDate(v);
        if (Number.isNaN(d.getTime())) {
          ctx.addIssue({ code: "custom", message: "Choose a date and time" });
          return z.NEVER;
        }
        return d;
      })
      .refine((d) => d === null || d.getTime() > Date.now() - 60_000, "Choose now or a later time, so past orders keep the rate they were charged"),
  })
  .refine((r) => r.scope !== "category" || r.categoryId, { message: "Choose a category", path: ["categoryId"] })
  .refine((r) => r.scope !== "business" || r.businessId, { message: "Choose a seller", path: ["businessId"] });
export type CommissionRuleInput = z.input<typeof commissionRuleSchema>;

export const zoneSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Give the zone a name").max(60),
  stateIds: z.array(z.coerce.number().int().positive()).min(1, "Choose at least one state").max(37),
  priority: z.coerce.number().int().min(0).max(1000),
  isActive: z.boolean(),
});
export type ZoneInput = z.input<typeof zoneSchema>;

/**
 * Platform settings, in the units admins think in. Keys and ranges match
 * lib/settings.ts, which falls back to a default for anything out of range.
 */
export const PLATFORM_SETTINGS = [
  { key: "fees.service_fee_percent", label: "Service fee (%)", hint: "Charged to shoppers on goods after discounts.", min: 0, max: 20, step: 0.1, group: "Fees" },
  { key: "fees.service_fee_cap_naira", label: "Service fee cap (₦)", hint: "The most a shopper pays in service fee per order.", min: 0, max: 1_000_000, step: 1, group: "Fees" },
  { key: "fees.vat_percent", label: "VAT on the service fee (%)", hint: "Nigerian VAT is 7.5%.", min: 0, max: 50, step: 0.1, group: "Fees" },
  { key: "commission.default_percent", label: "Default commission (%)", hint: "Used when no commission rule applies.", min: 0, max: 50, step: 0.1, group: "Fees" },
  { key: "checkout.stock_hold_minutes", label: "Stock hold at checkout (minutes)", hint: "How long stock is held while a shopper pays.", min: 5, max: 120, step: 1, group: "Checkout" },
  { key: "payments.pay_on_delivery_enabled", label: "Allow pay on delivery", hint: "Sellers still choose whether they accept it.", group: "Checkout", boolean: true },
  { key: "orders.auto_complete_days", label: "Auto-complete delivered orders after (days)", hint: "If the customer doesn't confirm delivery.", min: 1, max: 60, step: 1, group: "Orders and refunds" },
  { key: "refunds.seller_response_hours", label: "Seller refund response deadline (hours)", hint: "After this, the request goes to TownMart.", min: 1, max: 336, step: 1, group: "Orders and refunds" },
  { key: "refunds.late_cancel_percent", label: "Late booking cancellation refund (%)", hint: "Refunded when a customer cancels less than 24 hours before.", min: 0, max: 100, step: 1, group: "Orders and refunds" },
  { key: "escrow.release_days", label: "Escrow release (days after completion)", hint: "When seller earnings become available.", min: 0, max: 60, step: 1, group: "Payouts" },
  { key: "payouts.minimum_naira", label: "Automatic payout minimum (₦)", hint: "Sellers can still ask for any positive amount.", min: 0, max: 10_000_000, step: 1, group: "Payouts" },
  { key: "bookings.lead_minutes", label: "Booking lead time (minutes)", hint: "How soon a booking can start.", min: 0, max: 10_080, step: 1, group: "Bookings" },
  { key: "bookings.days_ahead", label: "Booking window (days ahead)", hint: "How far ahead customers can book.", min: 1, max: 365, step: 1, group: "Bookings" },
] as const;

export type PlatformSettingKey = (typeof PLATFORM_SETTINGS)[number]["key"];

export const platformSettingsSchema = z.record(z.string(), z.union([z.string(), z.boolean()])).transform((raw, ctx) => {
  const out: Record<string, number | boolean> = {};
  for (const s of PLATFORM_SETTINGS) {
    const v = raw[s.key];
    if ("boolean" in s) {
      out[s.key] = v === true;
      continue;
    }
    const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : Number.NaN;
    if (!Number.isFinite(n) || n < s.min || n > s.max) {
      ctx.addIssue({ code: "custom", message: `Enter a number from ${s.min.toLocaleString("en-NG")} to ${s.max.toLocaleString("en-NG")}`, path: [s.key] });
      continue;
    }
    out[s.key] = s.step < 1 ? Math.round(n * 100) / 100 : Math.round(n);
  }
  return out;
});
