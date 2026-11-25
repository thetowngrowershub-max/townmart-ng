import type { Tx } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Placeholder until the rider wallets land (they replace this file): pays a
 * TownMart pool rider their share of a delivery fee. Same signature as the
 * real one, which posts it to the ledger and is safe to call twice for the
 * same seller order. System scope.
 */
export async function creditRiderEarning(_tx: Tx, p: { riderId: string; sellerOrderId: string; amountKobo: bigint; memo: string }): Promise<void> {
  logger.info({ riderId: p.riderId, sellerOrderId: p.sellerOrderId, amountKobo: p.amountKobo.toString() }, "rider earning (wallets not built yet)");
}
