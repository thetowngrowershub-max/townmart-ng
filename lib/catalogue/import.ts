import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { withRls, withSystemContext } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { importFinishedTemplate } from "@/lib/notifications/email/templates";
import { enqueueEmail } from "@/lib/queue";
import { storage } from "@/lib/storage";
import type { ProductInput } from "@/lib/validation/catalogue";
import { CsvFormatError, groupByHandle, parseProductCsv, validateGroup, type ImportReport, type ProductGroup } from "./csv";
import { notifyLowStock } from "./low-stock";
import { CatalogueError, saveProduct, type StockChange } from "./products";

/**
 * Worker side of the CSV import. Each product (handle) is saved in its own
 * transaction under the business's RLS context and the uploader's identity,
 * so one bad row never blocks the rest and nothing can touch another seller.
 */
export async function runProductImport(importJobId: string, businessId: string): Promise<{ succeeded: number; failed: number }> {
  const job = await withRls({ userId: null, businessId }, (tx) =>
    tx.importJob.update({ where: { id: importJobId }, data: { status: "processing", startedAt: new Date() } }),
  );
  const ctx = { userId: job.createdBy, businessId };
  const report: ImportReport = { errors: [], warnings: [] };
  let succeeded = 0;
  let failed = 0;
  const stockChanges: StockChange[] = [];

  try {
    const buf = await storage().getObject("private", job.fileKey);
    if (!buf) throw new CsvFormatError("The uploaded file is missing. Please upload it again.");
    const rows = parseProductCsv(buf);
    const groups = groupByHandle(rows);

    const categories = await withRls(ctx, (tx) => tx.category.findMany({ where: { kind: "product", isActive: true }, select: { id: true, slug: true } }));
    const categoryIdBySlug = new Map(categories.map((c) => [c.slug, c.id]));

    for (const g of groups) {
      const outcome = await importGroup(g, ctx, categoryIdBySlug, job.createdBy);
      if (outcome.ok) {
        succeeded += g.rows.length;
        stockChanges.push(...outcome.stockChanges);
        if (outcome.warnings.length) report.warnings.push({ row: g.firstLine, handle: g.handle, messages: outcome.warnings });
      } else {
        failed += g.rows.length;
        report.errors.push({ row: g.firstLine, handle: g.handle, messages: outcome.errors });
      }
    }

    await withRls(ctx, async (tx) => {
      await tx.importJob.update({
        where: { id: importJobId },
        data: { status: "completed", totalRows: rows.length, succeededRows: succeeded, failedRows: failed, report: report as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
      });
      await writeAudit(tx, { actorUserId: job.createdBy, action: "product.import_completed", entityType: "import_job", entityId: importJobId, after: { succeeded, failed } });
    });
  } catch (err) {
    const message = err instanceof CsvFormatError ? err.message : "The import failed unexpectedly. Please try again.";
    if (!(err instanceof CsvFormatError)) logger.error({ err, importJobId }, "product import failed");
    await withRls(ctx, (tx) =>
      tx.importJob.update({
        where: { id: importJobId },
        data: { status: "failed", report: { errors: [{ row: 0, handle: "", messages: [message] }], warnings: [] }, finishedAt: new Date() },
      }),
    );
    failed = Math.max(failed, 1);
  }

  await notifyLowStock(businessId, stockChanges);
  const owner = await withSystemContext((tx) => tx.user.findUnique({ where: { id: job.createdBy }, select: { email: true } }));
  if (owner) {
    await enqueueEmail(
      importFinishedTemplate({ to: owner.email, fileName: job.fileName, succeeded, failed, url: new URL(`/dashboard/products/import/${importJobId}`, env().APP_URL).toString() }),
    );
  }
  return { succeeded, failed };
}

type GroupOutcome = { ok: true; warnings: string[]; stockChanges: StockChange[] } | { ok: false; errors: string[] };

async function importGroup(g: ProductGroup, ctx: { userId: string; businessId: string }, categoryIdBySlug: Map<string, string>, actorUserId: string): Promise<GroupOutcome> {
  const skus = g.rows.map((r) => r.sku.trim()).filter(Boolean);
  try {
    return await withRls(ctx, async (tx) => {
      const matches = await tx.productVariant.findMany({ where: { businessId: ctx.businessId, sku: { in: skus } }, select: { productId: true } });
      const productIds = [...new Set(matches.map((m) => m.productId))];
      if (productIds.length > 1) return { ok: false as const, errors: ["These SKUs belong to different existing products. Use one handle per product."] };

      const existing = productIds[0]
        ? await tx.product.findFirst({
            where: { id: productIds[0], businessId: ctx.businessId, deletedAt: null },
            include: { images: { orderBy: { sortOrder: "asc" } }, variants: { orderBy: { position: "asc" } } },
          })
        : null;
      if (productIds[0] && !existing) return { ok: false as const, errors: ["These SKUs belong to a deleted product."] };

      const images: ProductInput["images"] = (existing?.images ?? []).map((i) => ({ key: i.storageKey, altText: i.altText, width: i.width, height: i.height, isCover: i.isCover }));
      const warnings: string[] = [];
      let { input, parsed, errors } = validateGroup(g, categoryIdBySlug, images);
      if (images.length === 0 && input.status === "active") {
        // Publishing needs a photo; import as a draft rather than failing the row.
        warnings.push("Saved as a draft: add at least one image in the dashboard to publish it.");
        ({ input, parsed, errors } = validateGroup({ ...g, rows: g.rows.map((r, i) => (i === 0 ? { ...r, status: "draft" } : r)) }, categoryIdBySlug, images));
      }
      if (errors.length || !parsed.success) return { ok: false as const, errors };

      const data = parsed.data;
      if (existing) {
        // Update in place: match variants by SKU and keep variants the file doesn't mention.
        const bySku = new Map(existing.variants.map((v) => [v.sku.toUpperCase(), v]));
        const inFile = new Set(data.variants.map((v) => v.sku.toUpperCase()));
        data.variants = data.variants.map((v) => ({ ...v, id: bySku.get(v.sku.toUpperCase())?.id }));
        for (const v of existing.variants) {
          if (inFile.has(v.sku.toUpperCase())) continue;
          data.variants.push({
            id: v.id,
            sku: v.sku,
            barcode: v.barcode ?? undefined,
            optionValues: v.optionValues as Record<string, string>,
            price: v.priceKobo,
            compareAtPrice: v.compareAtPriceKobo,
            stockQty: v.stockQty.toString(),
            lowStockThreshold: v.lowStockThreshold.toString(),
          });
        }
        if (data.variants.length > 1 && data.options.length === 0) return { ok: false as const, errors: ["option names: this product has several variants, so give each row its options"] };
        data.slug = existing.slug;
      }

      const res = await saveProduct(tx, {
        businessId: ctx.businessId,
        actorUserId,
        data,
        productId: existing?.id,
        stockSource: { reason: "import", note: "CSV import" },
      });
      return { ok: true as const, warnings, stockChanges: res.stockChanges };
    });
  } catch (err) {
    if (err instanceof CatalogueError) return { ok: false, errors: [err.message] };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: false, errors: ["A SKU or handle in this product is already used."] };
    logger.error({ err, handle: g.handle }, "import row failed");
    return { ok: false, errors: ["Couldn't save this product. Check the values and try again."] };
  }
}

