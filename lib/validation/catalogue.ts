import { z } from "zod";
import { commaList, lagosDateTime, nairaAmount, optionalNairaAmount, quantity, signedQuantity, uuid } from "./common";

const units = ["piece", "kg", "litre", "crate", "bag", "pack"] as const;
const FRACTIONAL_UNITS: readonly string[] = ["kg", "litre"];
const listingStatus = z.enum(["draft", "active", "archived"]);
const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens")
  .max(80)
  .optional()
  .or(z.literal(""));

export const imageInput = z.object({
  key: z.string().min(10).max(200),
  altText: z.string().trim().min(3, "Describe the image for people using screen readers").max(160),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const productImageInput = imageInput.extend({ isCover: z.boolean() });

export const optionInput = z.object({
  name: z.string().trim().min(1, "Name the option, e.g. Size").max(30),
  values: commaList(30, 30).refine((v) => v.length > 0, "Add at least one value"),
});

export const variantInput = z.object({
  id: z.uuid().optional(),
  sku: z
    .string()
    .trim()
    .min(1, "Enter a SKU")
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "Letters, numbers, dots, dashes and underscores only"),
  barcode: z.string().trim().max(64).optional(),
  optionValues: z.record(z.string(), z.string()),
  price: nairaAmount,
  compareAtPrice: optionalNairaAmount,
  stockQty: quantity,
  lowStockThreshold: quantity,
  /** Key of one of the product's images to show when this variant is picked. */
  imageKey: z.string().max(200).optional().or(z.literal("")),
});

export const productInputSchema = z
  .object({
    title: z.string().trim().min(3, "Enter a title").max(120),
    descriptionHtml: z.string().max(20_000).default(""),
    categoryId: uuid,
    brand: z.string().trim().max(60).optional(),
    tags: commaList(10, 30),
    unit: z.enum(units),
    minOrderQty: quantity.refine((v) => Number(v) > 0, "Must be more than 0"),
    allowFractionalQty: z.boolean(),
    trackInventory: z.boolean(),
    allowBackorder: z.boolean(),
    weightGrams: z.coerce.number().int().min(0).max(1_000_000).optional(),
    lengthCm: z.coerce.number().min(0).max(1000).optional(),
    widthCm: z.coerce.number().min(0).max(1000).optional(),
    heightCm: z.coerce.number().min(0).max(1000).optional(),
    isPerishable: z.boolean(),
    shelfLifeNote: z.string().trim().max(200).optional(),
    costPrice: optionalNairaAmount,
    status: listingStatus,
    slug: slugField,
    metaTitle: z.string().trim().max(70).optional(),
    metaDescription: z.string().trim().max(160).optional(),
    options: z.array(optionInput).max(3, "At most 3 options"),
    variants: z.array(variantInput).min(1, "Add at least one variant").max(100, "At most 100 variants"),
    images: z.array(productImageInput).max(8, "At most 8 images"),
  })
  .superRefine((p, ctx) => {
    if (p.allowFractionalQty && !FRACTIONAL_UNITS.includes(p.unit)) {
      ctx.addIssue({ code: "custom", path: ["allowFractionalQty"], message: "Only kg and litre can be sold in fractions" });
    }
    if (!p.allowFractionalQty && !Number.isInteger(Number(p.minOrderQty))) {
      ctx.addIssue({ code: "custom", path: ["minOrderQty"], message: "Use a whole number, or allow fractional quantities" });
    }
    if (p.status === "active" && p.images.length === 0) {
      ctx.addIssue({ code: "custom", path: ["images"], message: "Add at least one image before publishing" });
    }
    if (p.images.length > 0 && p.images.filter((i) => i.isCover).length !== 1) {
      ctx.addIssue({ code: "custom", path: ["images"], message: "Choose exactly one cover image" });
    }

    const skus = new Set<string>();
    const combos = new Set<string>();
    const optionNames = p.options.map((o) => o.name);
    if (new Set(optionNames.map((n) => n.toLowerCase())).size !== optionNames.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Option names must be different" });
    }
    if (p.options.length === 0 && p.variants.length > 1) {
      ctx.addIssue({ code: "custom", path: ["variants"], message: "Add an option (e.g. Size) to sell more than one variant" });
    }
    p.variants.forEach((v, i) => {
      const sku = v.sku.toUpperCase();
      if (skus.has(sku)) ctx.addIssue({ code: "custom", path: ["variants", i, "sku"], message: "SKUs must be unique" });
      skus.add(sku);
      if (v.compareAtPrice !== null && v.compareAtPrice <= v.price) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "compareAtPrice"], message: "Must be higher than the price" });
      }
      if (!p.allowFractionalQty && !Number.isInteger(Number(v.stockQty))) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "stockQty"], message: "Use a whole number" });
      }
      const keys = Object.keys(v.optionValues).sort();
      const valid =
        keys.length === optionNames.length &&
        p.options.every((o) => o.values.includes(v.optionValues[o.name] ?? ""));
      if (!valid) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "optionValues"], message: "Pick a value for every option" });
      }
      if (v.imageKey && !p.images.some((img) => img.key === v.imageKey)) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "imageKey"], message: "Pick one of the product's images" });
      }
      const combo = p.options.map((o) => v.optionValues[o.name]).join("|");
      if (combos.has(combo)) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "optionValues"], message: "Two variants have the same options" });
      }
      combos.add(combo);
    });
  });
export type ProductInput = z.input<typeof productInputSchema>;
export type ProductData = z.output<typeof productInputSchema>;

export const stockAdjustmentSchema = z.object({
  variantId: z.uuid(),
  change: signedQuantity,
  note: z.string().trim().min(3, "Say why the stock changed").max(200),
});
export type StockAdjustmentInput = z.input<typeof stockAdjustmentSchema>;

export const bulkStatusSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(200),
  status: listingStatus,
});

// ─── Services ───────────────────────────────────────────────────────────────

/** `datetime-local` input, interpreted as Lagos time. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use HH:MM");

export const availabilityInput = z
  .object({
    weekday: z.coerce.number().int().min(0).max(6),
    start: timeOfDay,
    end: timeOfDay,
    slotMinutes: z.coerce.number().int().min(15).max(720),
    bufferMinutes: z.coerce.number().int().min(0).max(240),
    maxPerSlot: z.coerce.number().int().min(1).max(50),
  })
  .refine((a) => a.start < a.end, { path: ["end"], message: "Must be after the start time" });

export const blackoutInput = z
  .object({
    startsAt: lagosDateTime("Choose a start date and time"),
    endsAt: lagosDateTime("Choose an end date and time"),
    reason: z.string().trim().max(120).optional(),
  })
  .refine((b) => b.endsAt > b.startsAt, { path: ["endsAt"], message: "Must be after the start" });

export const packageInput = z.object({
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(300).optional(),
  price: nairaAmount,
  durationMinutes: z.coerce.number().int().min(5).max(24 * 60 * 14),
});

export const serviceInputSchema = z
  .object({
    title: z.string().trim().min(3, "Enter a title").max(120),
    descriptionHtml: z.string().max(20_000).default(""),
    categoryId: uuid,
    pricingModel: z.enum(["fixed", "from", "hourly", "packages"]),
    basePrice: nairaAmount,
    durationMinutes: z.coerce.number().int().min(5, "At least 5 minutes").max(24 * 60 * 14),
    locationMode: z.enum(["on_site", "at_provider", "both"]),
    serviceLgaIds: z.array(z.coerce.number().int().positive()).max(100),
    radiusKm: z.coerce.number().int().min(1).max(500).optional(),
    depositPercent: z.coerce.number().int().min(0).max(100),
    requiresConfirmation: z.boolean(),
    status: listingStatus,
    slug: slugField,
    metaTitle: z.string().trim().max(70).optional(),
    metaDescription: z.string().trim().max(160).optional(),
    packages: z.array(packageInput).max(3, "At most 3 packages (Basic, Standard, Premium)"),
    availability: z.array(availabilityInput).max(50),
    blackouts: z.array(blackoutInput).max(50),
    images: z.array(imageInput).max(8, "At most 8 images"),
  })
  .superRefine((s, ctx) => {
    if (s.pricingModel === "packages" && s.packages.length === 0) {
      ctx.addIssue({ code: "custom", path: ["packages"], message: "Add at least one package" });
    }
    if (s.locationMode !== "at_provider" && s.serviceLgaIds.length === 0 && !s.radiusKm) {
      ctx.addIssue({ code: "custom", path: ["serviceLgaIds"], message: "Choose the LGAs you cover, or a radius" });
    }
    if (s.status === "active" && s.availability.length === 0) {
      ctx.addIssue({ code: "custom", path: ["availability"], message: "Add your weekly availability before publishing" });
    }
    // Overlapping windows on the same day would double-count capacity.
    const byDay = new Map<number, { start: string; end: string; i: number }[]>();
    s.availability.forEach((a, i) => byDay.set(a.weekday, [...(byDay.get(a.weekday) ?? []), { start: a.start, end: a.end, i }]));
    for (const windows of byDay.values()) {
      windows.sort((a, b) => a.start.localeCompare(b.start));
      for (let k = 1; k < windows.length; k++) {
        if (windows[k]!.start < windows[k - 1]!.end) {
          ctx.addIssue({ code: "custom", path: ["availability", windows[k]!.i, "start"], message: "Overlaps another window that day" });
        }
      }
    }
  });
export type ServiceInput = z.input<typeof serviceInputSchema>;
export type ServiceData = z.output<typeof serviceInputSchema>;
