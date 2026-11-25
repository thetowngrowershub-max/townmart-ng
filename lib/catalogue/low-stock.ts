import { logger } from "@/lib/logger";
import { enqueueLowStockAlert } from "@/lib/queue";
import { crossedLowStock, type StockChange } from "./products";

/** Queues an alert for variants that just went from above their threshold to at/below it. */
export async function notifyLowStock(businessId: string, changes: StockChange[]): Promise<void> {
  const variantIds = changes.filter(crossedLowStock).map((c) => c.variantId);
  if (variantIds.length === 0) return;
  // An alert is a convenience: never fail the seller's save because Redis hiccuped.
  await enqueueLowStockAlert({ businessId, variantIds }).catch((err) => logger.warn({ err, businessId }, "low-stock alert not queued"));
}
