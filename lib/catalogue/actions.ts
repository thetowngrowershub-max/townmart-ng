"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { assertCan, AuthzError } from "@/lib/authz";
import { logger } from "@/lib/logger";
import { screenListing } from "@/lib/moderation/core";
import { getSellerContext, withSellerRls, type SellerContext } from "@/lib/seller/context";
import { storage } from "@/lib/storage";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { nairaAmount, quantity } from "@/lib/validation/common";
import {
  bulkStatusSchema,
  productInputSchema,
  serviceInputSchema,
  stockAdjustmentSchema,
  type ProductInput,
  type ServiceInput,
  type StockAdjustmentInput,
} from "@/lib/validation/catalogue";
import { notifyLowStock } from "./low-stock";
import { adjustStock, CatalogueError, type StockChange } from "./products";
import { saveProduct } from "./products";
import { saveService } from "./services";

type BusinessPermission = "listing.write" | "listing.read" | "import.manage" | "store.manage";

/** App-layer check: the caller must be a member of a business with this permission. */
async function sellerWith(permission: BusinessPermission): Promise<SellerContext> {
  const ctx = await getSellerContext();
  if (!ctx) throw new AuthzError(401, "Please sign in to your seller account.");
  assertCan(ctx.user, permission, { businessId: ctx.business.id });
  return ctx;
}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError) return { ok: false, error: err.message };
  if (err instanceof CatalogueError) {
    return { ok: false, error: err.message, fieldErrors: err.field ? { [err.field]: [err.message] } : undefined };
  }
  logger.error({ err }, "catalogue action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

const deleteFiles = (keys: string[]) =>
  Promise.all(keys.map((k) => storage().deleteObject("public", k).catch((err) => logger.warn({ err, key: k }, "image delete failed"))));

const idSchema = z.uuid();

const FLAGGED_MESSAGE = (what: string) =>
  `${what} saved. Some of its words are on our prohibited-items list, so TownMart will take a quick look. It stays live meanwhile.`;

// ─── Products ───────────────────────────────────────────────────────────────

export async function saveProductAction(productId: string | null, input: ProductInput): Promise<ActionResult<{ id: string; slug: string }>> {
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (productId !== null && !idSchema.safeParse(productId).success) return { ok: false, error: "Product not found." };
  try {
    const ctx = await sellerWith("listing.write");
    const res = await withSellerRls(ctx, async (tx) => {
      const r = await saveProduct(tx, { businessId: ctx.business.id, actorUserId: ctx.user.id, data: parsed.data, productId: productId ?? undefined });
      await writeAudit(tx, {
        actorUserId: ctx.user.id,
        action: productId ? "product.updated" : "product.created",
        entityType: "product",
        entityId: r.productId,
        after: { title: parsed.data.title, status: parsed.data.status, variants: parsed.data.variants.length },
      });
      return r;
    });
    await deleteFiles(res.removedImageKeys);
    await notifyLowStock(ctx.business.id, res.stockChanges);
    const flagged = await screenListing({ kind: "product", id: res.productId });
    revalidatePath("/dashboard/products");
    revalidatePath(`/p/${res.slug}`);
    return { ok: true, data: { id: res.productId, slug: res.slug }, message: flagged.length ? FLAGGED_MESSAGE("Product") : "Product saved." };
  } catch (err) {
    return failure(err);
  }
}

/** Soft delete: the row stays for order history; the listing disappears everywhere. */
export async function deleteProductAction(productId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(productId).success) return { ok: false, error: "Product not found." };
  try {
    const ctx = await sellerWith("listing.write");
    await withSellerRls(ctx, async (tx) => {
      const { count } = await tx.product.updateMany({
        where: { id: productId, businessId: ctx.business.id, deletedAt: null },
        data: { deletedAt: new Date(), status: "archived" },
      });
      if (count !== 1) throw new CatalogueError("Product not found.");
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "product.deleted", entityType: "product", entityId: productId });
    });
    revalidatePath("/dashboard/products");
    return { ok: true, message: "Product deleted." };
  } catch (err) {
    return failure(err);
  }
}

export async function bulkProductStatusAction(input: z.input<typeof bulkStatusSchema>): Promise<ActionResult<{ updated: number; skipped: number }>> {
  const parsed = bulkStatusSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { ids, status } = parsed.data;
  try {
    const ctx = await sellerWith("listing.write");
    const updated = await withSellerRls(ctx, async (tx) => {
      const { count } = await tx.product.updateMany({
        where: {
          id: { in: ids },
          businessId: ctx.business.id,
          deletedAt: null,
          // Publishing needs at least one image, the same rule as the product form.
          ...(status === "active" ? { images: { some: {} } } : {}),
        },
        data: { status, ...(status === "active" ? { publishedAt: new Date() } : {}) },
      });
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "product.bulk_status", entityType: "product", after: { ids, status, updated: count } });
      return count;
    });
    revalidatePath("/dashboard/products");
    const skipped = ids.length - updated;
    return {
      ok: true,
      data: { updated, skipped },
      message: `${updated} product${updated === 1 ? "" : "s"} updated.${skipped ? ` ${skipped} skipped (publishing needs at least one image).` : ""}`,
    };
  } catch (err) {
    return failure(err);
  }
}

export async function adjustStockAction(input: StockAdjustmentInput): Promise<ActionResult> {
  const parsed = stockAdjustmentSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await sellerWith("listing.write");
    const change = await withSellerRls(ctx, async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: parsed.data.variantId, businessId: ctx.business.id },
        select: { product: { select: { allowFractionalQty: true } } },
      });
      if (!variant) throw new CatalogueError("Variant not found.");
      if (!variant.product.allowFractionalQty && !Number.isInteger(Number(parsed.data.change))) {
        throw new CatalogueError("This product is sold in whole units.", "change");
      }
      return adjustStock(tx, {
        businessId: ctx.business.id,
        variantId: parsed.data.variantId,
        change: parsed.data.change,
        reason: "manual_adjustment",
        note: parsed.data.note,
        actorUserId: ctx.user.id,
      });
    });
    await notifyLowStock(ctx.business.id, [change]);
    revalidatePath("/dashboard/products");
    return { ok: true, message: `Stock is now ${change.after.toString()}.` };
  } catch (err) {
    return failure(err);
  }
}

const bulkEditSchema = z.object({
  rows: z
    .array(
      z.object({
        variantId: z.uuid(),
        price: nairaAmount.optional(),
        stockQty: quantity.optional(),
      }),
    )
    .min(1)
    .max(500),
});

/** Bulk price and stock edit. Stock changes are recorded as manual adjustments. */
export async function bulkEditVariantsAction(input: z.input<typeof bulkEditSchema>): Promise<ActionResult> {
  const parsed = bulkEditSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await sellerWith("listing.write");
    const changes: StockChange[] = [];
    const n = await withSellerRls(ctx, async (tx) => {
      const ids = parsed.data.rows.map((r) => r.variantId);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: ids }, businessId: ctx.business.id },
        select: { id: true, productId: true, stockQty: true, compareAtPriceKobo: true, product: { select: { allowFractionalQty: true } } },
      });
      const byId = new Map(variants.map((v) => [v.id, v]));
      const touched = new Set<string>();
      for (const row of parsed.data.rows) {
        const v = byId.get(row.variantId);
        if (!v) throw new CatalogueError("One of these variants isn't yours.");
        if (row.price !== undefined) {
          if (v.compareAtPriceKobo !== null && v.compareAtPriceKobo <= row.price) {
            throw new CatalogueError("A new price is at or above its compare-at price. Edit that product instead.");
          }
          await tx.productVariant.update({ where: { id: v.id }, data: { priceKobo: row.price } });
          touched.add(v.productId);
        }
        if (row.stockQty !== undefined) {
          if (!v.product.allowFractionalQty && !Number.isInteger(Number(row.stockQty))) throw new CatalogueError("Use whole numbers for stock.");
          const delta = new Prisma.Decimal(row.stockQty).minus(v.stockQty);
          if (!delta.isZero()) {
            changes.push(
              await adjustStock(tx, { businessId: ctx.business.id, variantId: v.id, change: delta, reason: "manual_adjustment", note: "Bulk edit", actorUserId: ctx.user.id, allowNegative: true }),
            );
          }
        }
      }
      // Keep each product's headline price equal to its cheapest variant.
      for (const productId of touched) {
        const min = await tx.productVariant.aggregate({ where: { productId }, _min: { priceKobo: true } });
        if (min._min.priceKobo !== null) await tx.product.update({ where: { id: productId }, data: { basePriceKobo: min._min.priceKobo } });
      }
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "variant.bulk_edit", entityType: "product_variant", after: { rows: parsed.data.rows.length } });
      return parsed.data.rows.length;
    });
    await notifyLowStock(ctx.business.id, changes);
    revalidatePath("/dashboard/products");
    return { ok: true, message: `${n} row${n === 1 ? "" : "s"} saved.` };
  } catch (err) {
    return failure(err);
  }
}

// ─── Services ───────────────────────────────────────────────────────────────

export async function saveServiceAction(serviceId: string | null, input: ServiceInput): Promise<ActionResult<{ id: string; slug: string }>> {
  const parsed = serviceInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (serviceId !== null && !idSchema.safeParse(serviceId).success) return { ok: false, error: "Service not found." };
  try {
    const ctx = await sellerWith("listing.write");
    const res = await withSellerRls(ctx, async (tx) => {
      const r = await saveService(tx, { businessId: ctx.business.id, data: parsed.data, serviceId: serviceId ?? undefined });
      await writeAudit(tx, {
        actorUserId: ctx.user.id,
        action: serviceId ? "service.updated" : "service.created",
        entityType: "service",
        entityId: r.serviceId,
        after: { title: parsed.data.title, status: parsed.data.status },
      });
      return r;
    });
    await deleteFiles(res.removedImageKeys);
    const flagged = await screenListing({ kind: "service", id: res.serviceId });
    revalidatePath("/dashboard/services");
    revalidatePath(`/s/${res.slug}`);
    return { ok: true, data: { id: res.serviceId, slug: res.slug }, message: flagged.length ? FLAGGED_MESSAGE("Service") : "Service saved." };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteServiceAction(serviceId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(serviceId).success) return { ok: false, error: "Service not found." };
  try {
    const ctx = await sellerWith("listing.write");
    await withSellerRls(ctx, async (tx) => {
      const { count } = await tx.service.updateMany({
        where: { id: serviceId, businessId: ctx.business.id, deletedAt: null },
        data: { deletedAt: new Date(), status: "archived" },
      });
      if (count !== 1) throw new CatalogueError("Service not found.");
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "service.deleted", entityType: "service", entityId: serviceId });
    });
    revalidatePath("/dashboard/services");
    return { ok: true, message: "Service deleted." };
  } catch (err) {
    return failure(err);
  }
}

export async function bulkServiceStatusAction(input: z.input<typeof bulkStatusSchema>): Promise<ActionResult> {
  const parsed = bulkStatusSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { ids, status } = parsed.data;
  try {
    const ctx = await sellerWith("listing.write");
    const updated = await withSellerRls(ctx, async (tx) => {
      const { count } = await tx.service.updateMany({
        where: {
          id: { in: ids },
          businessId: ctx.business.id,
          deletedAt: null,
          // Publishing needs weekly availability, the same rule as the service form.
          ...(status === "active" ? { availability: { some: {} } } : {}),
        },
        data: { status, ...(status === "active" ? { publishedAt: new Date() } : {}) },
      });
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "service.bulk_status", entityType: "service", after: { ids, status, updated: count } });
      return count;
    });
    revalidatePath("/dashboard/services");
    const skipped = ids.length - updated;
    return { ok: true, message: `${updated} service${updated === 1 ? "" : "s"} updated.${skipped ? ` ${skipped} skipped (publishing needs weekly availability).` : ""}` };
  } catch (err) {
    return failure(err);
  }
}
