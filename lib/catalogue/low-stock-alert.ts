import { withSystemContext } from "@/lib/db";
import { env } from "@/lib/env";
import { lowStockTemplate } from "@/lib/notifications/email/templates";
import { enqueueEmail } from "@/lib/queue";
import { redis } from "@/lib/redis";

/**
 * Worker handler for "stock.low": emails the business about variants that are
 * still at or below their threshold, at most once a day per variant.
 */
export async function sendLowStockAlert(businessId: string, variantIds: string[]): Promise<number> {
  const rows = await withSystemContext((tx) =>
    tx.productVariant.findMany({
      where: { id: { in: variantIds }, businessId, product: { deletedAt: null, trackInventory: true } },
      select: { id: true, sku: true, stockQty: true, lowStockThreshold: true, product: { select: { title: true, business: { select: { name: true, email: true } } } } },
    }),
  );
  const items = [];
  for (const v of rows) {
    if (v.stockQty.gt(v.lowStockThreshold)) continue;
    const fresh = await redis.set(`lowstock:${v.id}`, "1", "EX", 24 * 3600, "NX");
    if (fresh !== "OK") continue;
    items.push({ title: v.product.title, sku: v.sku, stock: v.stockQty.toString(), threshold: v.lowStockThreshold.toString() });
  }
  const business = rows[0]?.product.business;
  if (!business || items.length === 0) return 0;
  await enqueueEmail(lowStockTemplate({ to: business.email, businessName: business.name, items, url: new URL("/dashboard/products?stock=low", env().APP_URL).toString() }));
  return items.length;
}
