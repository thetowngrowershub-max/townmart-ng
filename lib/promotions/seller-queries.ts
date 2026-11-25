import "server-only";
import type { Prisma } from "@prisma/client";
import type { PickOption } from "@/components/seller/promotion-form";
import type { Tx } from "@/lib/db";
import { dateToLagosLocal } from "@/lib/datetime";
import { formatPrice, koboToNairaString } from "@/lib/money";
import type { PromotionInput } from "@/lib/validation/promotions";

/** What a seller can put on promotion: their own live and draft listings, and the categories they sell in. */
export async function promotionPickOptions(tx: Tx, businessId: string) {
  const products = await tx.product.findMany({
    where: { businessId, deletedAt: null, status: { not: "archived" } },
    orderBy: { title: "asc" },
    select: { id: true, title: true, basePriceKobo: true, status: true, categoryId: true },
  });
  const services = await tx.service.findMany({
    where: { businessId, deletedAt: null, status: { not: "archived" } },
    orderBy: { title: "asc" },
    select: { id: true, title: true, basePriceKobo: true, status: true, categoryId: true },
  });
  const used = [...new Set([...products, ...services].map((l) => l.categoryId))];
  const categories = await tx.category.findMany({
    where: { isActive: true, OR: [{ id: { in: used } }, { children: { some: { id: { in: used } } } }] },
    orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: { id: true, name: true, parent: { select: { name: true } } },
  });
  const pick = (l: { id: string; title: string; basePriceKobo: bigint; status: string }): PickOption => ({
    id: l.id,
    label: l.title,
    detail: `${formatPrice(l.basePriceKobo)}${l.status === "draft" ? " · draft" : ""}`,
  });
  return {
    products: products.map(pick),
    services: services.map(pick),
    categories: categories.map((c) => ({ id: c.id, label: c.parent ? `${c.parent.name} › ${c.name}` : `${c.name} (all)` })),
  };
}

/** A new promotion starts at the next whole hour and runs for a week. */
export function emptyPromotion(now = new Date()): PromotionInput {
  const start = new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000);
  return {
    name: "",
    description: "",
    discountType: "percentage",
    discountValue: "10",
    scope: "store",
    productIds: [],
    serviceIds: [],
    categoryIds: [],
    startsAt: dateToLagosLocal(start),
    endsAt: dateToLagosLocal(new Date(start.getTime() + 7 * 86_400_000)),
    usageLimit: "",
    perCustomerLimit: "",
    minOrder: "",
    isFlashDeal: false,
    isActive: true,
    couponCode: "",
    allowsStacking: false,
  };
}

export const promotionEditSelect = {
  id: true,
  name: true,
  description: true,
  discountType: true,
  discountValue: true,
  scope: true,
  startsAt: true,
  endsAt: true,
  usageLimit: true,
  perCustomerLimit: true,
  minOrderKobo: true,
  isFlashDeal: true,
  isActive: true,
  redemptionCount: true,
  targets: { select: { productId: true, serviceId: true, categoryId: true } },
  coupon: { select: { code: true, allowsStacking: true } },
} satisfies Prisma.PromotionSelect;

export function promotionToFormValues(p: Prisma.PromotionGetPayload<{ select: typeof promotionEditSelect }>): PromotionInput {
  return {
    name: p.name,
    description: p.description ?? "",
    discountType: p.discountType,
    discountValue: p.discountType === "percentage" ? p.discountValue.toString() : koboToNairaString(p.discountValue),
    scope: p.scope,
    productIds: p.targets.flatMap((t) => (t.productId ? [t.productId] : [])),
    serviceIds: p.targets.flatMap((t) => (t.serviceId ? [t.serviceId] : [])),
    categoryIds: p.targets.flatMap((t) => (t.categoryId ? [t.categoryId] : [])),
    startsAt: dateToLagosLocal(p.startsAt),
    endsAt: dateToLagosLocal(p.endsAt),
    usageLimit: p.usageLimit?.toString() ?? "",
    perCustomerLimit: p.perCustomerLimit?.toString() ?? "",
    minOrder: p.minOrderKobo > 0n ? koboToNairaString(p.minOrderKobo) : "",
    isFlashDeal: p.isFlashDeal,
    isActive: p.isActive,
    couponCode: p.coupon?.code ?? "",
    allowsStacking: p.coupon?.allowsStacking ?? false,
  };
}

export function describeDiscount(p: { discountType: "percentage" | "fixed"; discountValue: bigint }) {
  return p.discountType === "percentage" ? `${p.discountValue}% off` : `${formatPrice(p.discountValue)} off each item`;
}

/** What TownMart's own promotions can target: every active category. */
export async function platformPickOptions(tx: Tx) {
  const categories = await tx.category.findMany({
    where: { isActive: true },
    orderBy: [{ kind: "asc" }, { parentId: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: { id: true, name: true, parent: { select: { name: true } } },
  });
  return { products: [], services: [], categories: categories.map((c) => ({ id: c.id, label: c.parent ? `${c.parent.name} › ${c.name}` : `${c.name} (all)` })) };
}
