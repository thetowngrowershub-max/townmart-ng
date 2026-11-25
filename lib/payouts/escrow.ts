import type { SellerOrder } from "@prisma/client";
import { withSystemContext, type Tx } from "@/lib/db";
import { allocate, escrowReleasePostings, podSettlementPostings } from "@/lib/ledger/entries";
import { postLedgerTransaction } from "@/lib/ledger/post";

/**
 * Escrow release. A seller's share of an online payment is held in escrow
 * until the order is delivered and the release period has passed (escrow
 * release days, default 3); then it moves to their available balance and is
 * paid out. Nothing is released while a refund request or a dispute about
 * the order is open.
 *
 * Pay-on-delivery orders work the other way round: the seller already holds
 * the cash, so at the same point TownMart's commission and service fee are
 * taken from their available balance.
 */

/** What's still held in escrow for a seller order: its escrow credit less refunds taken from escrow. */
export async function escrowHeld(tx: Tx, so: SellerOrder): Promise<bigint> {
  const taken = await tx.refund.aggregate({
    where: { sellerOrderId: so.id, debitedFrom: "escrow", status: { in: ["approved", "processing", "completed", "failed"] } },
    _sum: { sellerDebitKobo: true },
  });
  return so.sellerNetKobo - so.payLaterKobo - (taken._sum.sellerDebitKobo ?? 0n);
}

/** This seller's share of a pay-on-delivery order's service fee and VAT, in proportion to their goods. */
async function podFeeShare(tx: Tx, so: SellerOrder): Promise<{ feeKobo: bigint; vatKobo: bigint }> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: so.orderId }, include: { sellerOrders: { orderBy: { id: "asc" } } } });
  const weights = order.sellerOrders.map((s) => s.subtotalKobo - s.discountKobo);
  const i = order.sellerOrders.findIndex((s) => s.id === so.id);
  return { feeKobo: allocate(order.serviceFeeKobo, weights)[i]!, vatKobo: allocate(order.vatKobo, weights)[i]! };
}

async function blocked(tx: Tx, sellerOrderId: string): Promise<boolean> {
  const [refunds, disputes] = await Promise.all([
    tx.refund.count({ where: { sellerOrderId, status: "requested" } }),
    tx.dispute.count({ where: { sellerOrderId, status: "open" } }),
  ]);
  return refunds + disputes > 0;
}

/** Releases (or settles) one seller order if it's due. System scope. Returns the amount moved, or null if not due. */
export async function releaseSellerOrder(tx: Tx, sellerOrderId: string, now = new Date()): Promise<bigint | null> {
  await tx.$queryRaw`SELECT id FROM seller_orders WHERE id = ${sellerOrderId}::uuid FOR UPDATE`;
  const so = await tx.sellerOrder.findUnique({ where: { id: sellerOrderId } });
  if (!so || so.escrowReleasedAt || !so.escrowReleaseAt || so.escrowReleaseAt > now) return null;
  if (await blocked(tx, so.id)) return null;

  if (so.payOnDelivery) {
    // Settled once the seller has the cash; a cancelled order owes nothing.
    if (so.status === "cancelled") {
      await tx.sellerOrder.update({ where: { id: so.id }, data: { escrowReleasedAt: now } });
      return 0n;
    }
    if (!so.cashCollectedAt) return null;
    const fee = await podFeeShare(tx, so);
    await postLedgerTransaction(tx, {
      kind: "pod_settled",
      referenceType: "seller_order",
      referenceId: so.id,
      memo: `${so.orderNumber}: commission and service fee on pay on delivery`,
      postings: podSettlementPostings({ businessId: so.businessId, commissionKobo: so.commissionKobo, platformDiscountKobo: so.platformDiscountKobo, ...fee }),
    });
    await tx.sellerOrder.update({ where: { id: so.id }, data: { escrowReleasedAt: now } });
    return -(so.commissionKobo + fee.feeKobo + fee.vatKobo - so.platformDiscountKobo);
  }

  const amount = await escrowHeld(tx, so);
  if (amount !== 0n) {
    await postLedgerTransaction(tx, {
      kind: "escrow_released",
      referenceType: "seller_order",
      referenceId: so.id,
      memo: `${so.orderNumber}: released from escrow`,
      postings: escrowReleasePostings(so.businessId, amount),
    });
  }
  await tx.sellerOrder.update({ where: { id: so.id }, data: { escrowReleasedAt: now } });
  return amount;
}

/** Worker job: releases every seller order that's due. One transaction per order. */
export async function releaseDueEscrow(now = new Date()): Promise<{ released: number; settled: number }> {
  const due = await withSystemContext((tx) =>
    tx.sellerOrder.findMany({ where: { escrowReleasedAt: null, escrowReleaseAt: { lte: now }, OR: [{ payOnDelivery: false }, { cashCollectedAt: { not: null } }] }, select: { id: true, payOnDelivery: true }, orderBy: { escrowReleaseAt: "asc" }, take: 500 }),
  );
  let released = 0;
  let settled = 0;
  for (const so of due) {
    const moved = await withSystemContext((tx) => releaseSellerOrder(tx, so.id, now));
    if (moved === null) continue;
    if (so.payOnDelivery) settled++;
    else released++;
  }
  return { released, settled };
}
