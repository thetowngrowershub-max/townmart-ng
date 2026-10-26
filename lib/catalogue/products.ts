import { Prisma, type StockMovementReason } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { sanitizeRichText } from "@/lib/sanitize";
import { imagePrefix } from "@/lib/storage/uploads";
import type { ProductData } from "@/lib/validation/catalogue";
import { listingSlug } from "./slug";

/** A business-rule failure the seller can fix; `field` points at the form field. */
export class CatalogueError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "CatalogueError";
  }
}

export type StockChange = {
  variantId: string;
  productId: string;
  before: Prisma.Decimal;
  after: Prisma.Decimal;
  threshold: Prisma.Decimal;
};

/** True when this change took the variant from above its threshold to at/below it. */
export const crossedLowStock = (c: StockChange) => c.before.gt(c.threshold) && c.after.lte(c.threshold);

/**
 * Changes a variant's stock and records why, in one statement plus one insert.
 * The UPDATE … RETURNING takes a row lock, so concurrent changes serialise and
 * the recorded balance_after is always exact. RLS limits it to the caller's business.
 */
export async function adjustStock(
  tx: Tx,
  params: {
    businessId: string;
    variantId: string;
    change: Prisma.Decimal | string;
    reason: StockMovementReason;
    note?: string;
    actorUserId?: string | null;
    referenceType?: string;
    referenceId?: string;
    allowNegative?: boolean;
  },
): Promise<StockChange> {
  const change = new Prisma.Decimal(params.change);
  if (change.isZero()) throw new CatalogueError("Stock change can't be zero");

  const rows = await tx.$queryRaw<{ stock_qty: Prisma.Decimal; low_stock_threshold: Prisma.Decimal; product_id: string; allow_backorder: boolean }[]>`
    UPDATE product_variants v
       SET stock_qty = v.stock_qty + ${change}
      FROM products p
     WHERE v.id = ${params.variantId}::uuid
       AND v.business_id = ${params.businessId}::uuid
       AND p.id = v.product_id
    RETURNING v.stock_qty, v.low_stock_threshold, v.product_id, p.allow_backorder`;
  const row = rows[0];
  if (!row) throw new CatalogueError("Variant not found");

  const after = new Prisma.Decimal(row.stock_qty);
  if (after.isNegative() && !row.allow_backorder && !params.allowNegative) {
    throw new CatalogueError(`Stock can't go below zero (it would be ${after.toString()})`, "change");
  }

  await tx.stockMovement.create({
    data: {
      variantId: params.variantId,
      businessId: params.businessId,
      changeQty: change,
      balanceAfter: after,
      reason: params.reason,
      note: params.note ?? null,
      actorUserId: params.actorUserId ?? null,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
    },
  });
  return {
    variantId: params.variantId,
    productId: row.product_id,
    before: after.minus(change),
    after,
    threshold: new Prisma.Decimal(row.low_stock_threshold),
  };
}

export type SaveProductResult = { productId: string; slug: string; removedImageKeys: string[]; stockChanges: StockChange[] };

/**
 * Creates or updates a product with its options, variants and images in the
 * caller's transaction. Stock edits made in the form are recorded as manual
 * adjustments, so the stock log always explains the current quantity.
 */
export async function saveProduct(
  tx: Tx,
  params: {
    businessId: string;
    actorUserId: string;
    data: ProductData;
    productId?: string;
    /** How stock edits are labelled in the stock log. */
    stockSource?: { reason: StockMovementReason; note: string };
  },
): Promise<SaveProductResult> {
  const { businessId, actorUserId, data } = params;
  const source = params.stockSource;

  const category = await tx.category.findUnique({ where: { id: data.categoryId }, select: { kind: true, isActive: true } });
  if (!category || category.kind !== "product" || !category.isActive) {
    throw new CatalogueError("Choose a product category", "categoryId");
  }
  const prefix = imagePrefix("product", businessId);
  if (data.images.some((i) => !i.key.startsWith(prefix))) throw new CatalogueError("One of the images isn't yours", "images");

  const existing = params.productId
    ? await tx.product.findFirst({
        where: { id: params.productId, businessId, deletedAt: null },
        select: { id: true, slug: true, publishedAt: true, images: { select: { storageKey: true } } },
      })
    : null;
  if (params.productId && !existing) throw new CatalogueError("Product not found");

  const prices = data.variants.map((v) => v.price);
  const basePriceKobo = prices.reduce((a, b) => (b < a ? b : a));
  const defaultVariant = data.variants[0]!;
  const slug = data.slug || existing?.slug || listingSlug(data.title);

  const fields = {
    categoryId: data.categoryId,
    title: data.title,
    slug,
    descriptionHtml: sanitizeRichText(data.descriptionHtml),
    brand: data.brand || null,
    tags: data.tags,
    basePriceKobo,
    compareAtPriceKobo: defaultVariant.compareAtPrice !== null && defaultVariant.price === basePriceKobo ? defaultVariant.compareAtPrice : null,
    costPriceKobo: data.costPrice,
    unit: data.unit,
    minOrderQty: new Prisma.Decimal(data.minOrderQty),
    allowFractionalQty: data.allowFractionalQty,
    trackInventory: data.trackInventory,
    allowBackorder: data.allowBackorder,
    weightGrams: data.weightGrams ?? null,
    dimensions:
      data.lengthCm || data.widthCm || data.heightCm
        ? { lengthCm: data.lengthCm ?? null, widthCm: data.widthCm ?? null, heightCm: data.heightCm ?? null }
        : Prisma.DbNull,
    isPerishable: data.isPerishable,
    shelfLifeNote: data.isPerishable ? data.shelfLifeNote || null : null,
    status: data.status,
    metaTitle: data.metaTitle || null,
    metaDescription: data.metaDescription || null,
    publishedAt: data.status === "active" ? (existing?.publishedAt ?? new Date()) : (existing?.publishedAt ?? null),
  };

  let productId: string;
  try {
    productId = existing
      ? (await tx.product.update({ where: { id: existing.id }, data: fields, select: { id: true } })).id
      : (await tx.product.create({ data: { ...fields, businessId }, select: { id: true } })).id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new CatalogueError("That web address is already taken", "slug");
    }
    throw err;
  }

  // Options: replace wholesale.
  await tx.productOption.deleteMany({ where: { productId } });
  if (data.options.length) {
    await tx.productOption.createMany({
      data: data.options.map((o, position) => ({ productId, businessId, name: o.name, values: o.values, position })),
    });
  }

  // Variants: update in place (keeps history), create new ones, delete removed ones.
  const current = await tx.productVariant.findMany({ where: { productId }, select: { id: true, stockQty: true } });
  const currentById = new Map(current.map((v) => [v.id, v]));
  const keepIds = new Set(data.variants.map((v) => v.id).filter((id): id is string => !!id && currentById.has(id)));
  const stockChanges: StockChange[] = [];
  const variantIdByImageKey = new Map<string, string>();

  for (const removed of current.filter((v) => !keepIds.has(v.id))) {
    if (!new Prisma.Decimal(removed.stockQty).isZero()) {
      throw new CatalogueError("Set a variant's stock to 0 before removing it", "variants");
    }
    await tx.productVariant.delete({ where: { id: removed.id } });
  }

  // Clear the default flag first so the partial unique index never sees two defaults.
  await tx.productVariant.updateMany({ where: { productId }, data: { isDefault: false } });

  try {
    for (const [position, v] of data.variants.entries()) {
      const variantFields = {
        sku: v.sku,
        barcode: v.barcode || null,
        optionValues: v.optionValues,
        priceKobo: v.price,
        compareAtPriceKobo: v.compareAtPrice,
        lowStockThreshold: new Prisma.Decimal(v.lowStockThreshold),
        isDefault: position === 0,
        position,
      };
      const target = new Prisma.Decimal(v.stockQty);
      const prev = v.id ? currentById.get(v.id) : undefined;
      if (prev) {
        await tx.productVariant.update({ where: { id: prev.id }, data: variantFields });
        if (v.imageKey) variantIdByImageKey.set(v.imageKey, prev.id);
        const delta = target.minus(new Prisma.Decimal(prev.stockQty));
        if (!delta.isZero()) {
          stockChanges.push(
            await adjustStock(tx, { businessId, variantId: prev.id, change: delta, reason: source?.reason ?? "manual_adjustment", note: source?.note ?? "Edited in product form", actorUserId, allowNegative: true }),
          );
        }
      } else {
        const created = await tx.productVariant.create({ data: { ...variantFields, productId, businessId }, select: { id: true } });
        if (v.imageKey) variantIdByImageKey.set(v.imageKey, created.id);
        if (!target.isZero()) {
          stockChanges.push(
            await adjustStock(tx, { businessId, variantId: created.id, change: target, reason: source?.reason ?? "manual_adjustment", note: source?.note ?? "Opening stock", actorUserId }),
          );
        }
      }
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new CatalogueError("One of these SKUs is already used by another of your products", "variants");
    }
    throw err;
  }

  // Images: replace rows; report removed keys so the caller can delete the files after commit.
  await tx.productImage.deleteMany({ where: { productId } });
  if (data.images.length) {
    await tx.productImage.createMany({
      data: data.images.map((img, sortOrder) => ({
        productId,
        businessId,
        storageKey: img.key,
        altText: img.altText,
        width: img.width,
        height: img.height,
        isCover: img.isCover,
        variantId: variantIdByImageKey.get(img.key) ?? null,
        sortOrder,
      })),
    });
  }
  const keptKeys = new Set(data.images.map((i) => i.key));
  const removedImageKeys = (existing?.images ?? []).map((i) => i.storageKey).filter((k) => !keptKeys.has(k));

  return { productId, slug, removedImageKeys, stockChanges };
}
