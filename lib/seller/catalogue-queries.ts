import "server-only";
import type { CategoryKind, Prisma } from "@prisma/client";
import type { GalleryImage } from "@/components/uploads/image-gallery-input";
import { categoryAttributeDefs, type AttributeDef } from "@/lib/catalogue/attributes";
import type { Tx } from "@/lib/db";
import { koboToNairaString } from "@/lib/money";
import { publicImageUrl } from "@/lib/storage";
import { minutesToTime } from "@/lib/catalogue/units";
import { dateToLagosLocal } from "@/lib/datetime";
import type { ProductFormValues } from "@/components/seller/product-form";
import type { ServiceFormValues } from "@/components/seller/service-form";

export async function categoryOptions(tx: Tx, kind: CategoryKind) {
  const all = await tx.category.findMany({
    where: { kind, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, parentId: true },
  });
  return all
    .filter((c) => !c.parentId)
    .map((c) => ({ id: c.id, name: c.name, children: all.filter((s) => s.parentId === c.id).map((s) => ({ id: s.id, name: s.name })) }));
}

/** Every product category's attributes, for the product form to show as the seller picks a category. */
export async function productAttributeDefs(tx: Tx): Promise<Record<string, AttributeDef[]>> {
  const ids = await tx.category.findMany({ where: { kind: "product", isActive: true }, select: { id: true } });
  const defs = await categoryAttributeDefs(tx, ids.map((c) => c.id));
  return Object.fromEntries([...defs].filter(([, d]) => d.length > 0));
}

export const EMPTY_PRODUCT: ProductFormValues = {
  title: "",
  descriptionHtml: "",
  categoryId: "",
  brand: "",
  tags: "",
  unit: "piece",
  minOrderQty: "1",
  allowFractionalQty: false,
  trackInventory: true,
  allowBackorder: false,
  isPerishable: false,
  shelfLifeNote: "",
  costPrice: "",
  status: "draft",
  slug: "",
  metaTitle: "",
  metaDescription: "",
  options: [],
  variants: [{ sku: "", barcode: "", optionValues: {}, price: "", compareAtPrice: "", stockQty: "0", lowStockThreshold: "5", imageKey: "" }],
  images: [],
  attributes: {},
};

export type ProductForEdit = Prisma.ProductGetPayload<{
  include: { options: true; variants: true; images: true };
}>;

export function productToFormValues(p: ProductForEdit): ProductFormValues {
  const dims = (p.dimensions ?? null) as { lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null } | null;
  const images: GalleryImage[] = [...p.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => ({ key: i.storageKey, url: publicImageUrl(i.storageKey), width: i.width, height: i.height, altText: i.altText, isCover: i.isCover }));
  const imageKeyByVariant = new Map(p.images.filter((i) => i.variantId).map((i) => [i.variantId!, i.storageKey]));
  return {
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    categoryId: p.categoryId,
    brand: p.brand ?? "",
    tags: p.tags.join(", "),
    unit: p.unit,
    minOrderQty: p.minOrderQty.toString(),
    allowFractionalQty: p.allowFractionalQty,
    trackInventory: p.trackInventory,
    allowBackorder: p.allowBackorder,
    weightGrams: p.weightGrams ?? undefined,
    lengthCm: dims?.lengthCm ?? undefined,
    widthCm: dims?.widthCm ?? undefined,
    heightCm: dims?.heightCm ?? undefined,
    isPerishable: p.isPerishable,
    shelfLifeNote: p.shelfLifeNote ?? "",
    costPrice: p.costPriceKobo !== null ? koboToNairaString(p.costPriceKobo) : "",
    status: p.status,
    slug: p.slug,
    metaTitle: p.metaTitle ?? "",
    metaDescription: p.metaDescription ?? "",
    options: [...p.options].sort((a, b) => a.position - b.position).map((o) => ({ name: o.name, values: o.values.join(", ") })),
    variants: [...p.variants]
      .sort((a, b) => a.position - b.position)
      .map((v) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode ?? "",
        optionValues: v.optionValues as Record<string, string>,
        price: koboToNairaString(v.priceKobo),
        compareAtPrice: v.compareAtPriceKobo !== null ? koboToNairaString(v.compareAtPriceKobo) : "",
        stockQty: v.stockQty.toString(),
        lowStockThreshold: v.lowStockThreshold.toString(),
        imageKey: imageKeyByVariant.get(v.id) ?? "",
      })),
    images,
    attributes: Object.fromEntries(Object.entries((p.attributes ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
  };
}

export const EMPTY_SERVICE: ServiceFormValues = {
  title: "",
  descriptionHtml: "",
  categoryId: "",
  pricingModel: "fixed",
  basePrice: "",
  durationMinutes: 60,
  locationMode: "on_site",
  serviceLgaIds: [],
  depositPercent: 0,
  requiresConfirmation: true,
  status: "draft",
  slug: "",
  metaTitle: "",
  metaDescription: "",
  packages: [],
  availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "17:00", slotMinutes: 60, bufferMinutes: 0, maxPerSlot: 1 })),
  blackouts: [],
  images: [],
};

export type ServiceForEdit = Prisma.ServiceGetPayload<{
  include: { packages: true; images: true; availability: true; blackouts: true };
}>;

export function serviceToFormValues(s: ServiceForEdit): ServiceFormValues {
  return {
    title: s.title,
    descriptionHtml: s.descriptionHtml,
    categoryId: s.categoryId,
    pricingModel: s.pricingModel,
    basePrice: koboToNairaString(s.basePriceKobo),
    durationMinutes: s.durationMinutes,
    locationMode: s.locationMode,
    serviceLgaIds: s.serviceLgaIds,
    radiusKm: s.radiusKm ?? undefined,
    depositPercent: s.depositPercent,
    requiresConfirmation: s.requiresConfirmation,
    status: s.status,
    slug: s.slug,
    metaTitle: s.metaTitle ?? "",
    metaDescription: s.metaDescription ?? "",
    packages: [...s.packages]
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ name: p.name, description: p.description ?? "", price: koboToNairaString(p.priceKobo), durationMinutes: p.durationMinutes })),
    availability: [...s.availability]
      .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)
      .map((a) => ({
        weekday: a.weekday,
        start: minutesToTime(a.startMinute),
        end: minutesToTime(a.endMinute),
        slotMinutes: a.slotMinutes,
        bufferMinutes: a.bufferMinutes,
        maxPerSlot: a.maxPerSlot,
      })),
    blackouts: [...s.blackouts]
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((b) => ({ startsAt: dateToLagosLocal(b.startsAt), endsAt: dateToLagosLocal(b.endsAt), reason: b.reason ?? "" })),
    images: [...s.images]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({ key: i.storageKey, url: publicImageUrl(i.storageKey), width: i.width, height: i.height, altText: i.altText, isCover: false })),
  };
}

export async function lgaGroups(tx: Tx) {
  const states = await tx.state.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, lgas: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
  });
  return states.map((s) => ({ stateId: s.id, stateName: s.name, lgas: s.lgas }));
}
