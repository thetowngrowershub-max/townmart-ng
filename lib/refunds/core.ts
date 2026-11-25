import { Prisma, type Refund, type RefundOrigin, type RefundReason, type RefundStatus, type SellerOrder } from "@prisma/client";
import { moveBooking } from "@/lib/bookings/status";
import { adjustStock } from "@/lib/catalogue/products";
import { withSystemContext, type Tx } from "@/lib/db";
import { refundApprovedPostings, refundPaidPostings, unappliedPaymentPostings } from "@/lib/ledger/entries";
import { postLedgerTransaction } from "@/lib/ledger/post";
import { logger } from "@/lib/logger";
import { formatPrice } from "@/lib/money";
import { recordStatus } from "@/lib/orders/status";
import { paymentProvider, type ProviderName, type ProviderRefund } from "@/lib/payments";
import { enqueueNotice } from "@/lib/queue";
import { feeRefund, itemPaidOnline, itemRefund, paidOnline, refundSplit, RefundError } from "./math";

export { RefundError } from "./math";

/**
 * Refunds, all in the system scope (they move money and stock across
 * sellers' tables); callers check permissions first and pass the business id
 * when a seller is acting, so a seller can only touch their own.
 *
 * Life of a refund: requested → approved (ledger written, money owed to the
 * customer) → processing (sent to the provider) → completed (ledger again:
 * paid out). A seller can decline a request; the customer can then take it
 * to TownMart as a dispute.
 */

/** Refunds that count against what's left to refund: decided and owed or paid. */
export const OWED: RefundStatus[] = ["approved", "processing", "completed", "failed"];

async function lockSellerOrder(tx: Tx, id: string, businessId?: string): Promise<SellerOrder> {
  await tx.$queryRaw`SELECT id FROM seller_orders WHERE id = ${id}::uuid FOR UPDATE`;
  const so = await tx.sellerOrder.findUnique({ where: { id } });
  if (!so || (businessId && so.businessId !== businessId)) throw new RefundError("Order not found.");
  return so;
}

async function lockRefund(tx: Tx, id: string, businessId?: string): Promise<Refund> {
  await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${id}::uuid FOR UPDATE`;
  const r = await tx.refund.findUnique({ where: { id } });
  if (!r || (businessId && r.businessId !== businessId)) throw new RefundError("Refund not found.");
  return r;
}

async function nextRefundNumber(tx: Tx): Promise<string> {
  const rows = await tx.$queryRaw<{ n: string }[]>`SELECT next_refund_number() AS n`;
  return rows[0]!.n;
}

/** What has already been refunded (or is owed) on a seller order. */
export async function refundedSoFar(tx: Tx, sellerOrderId: string) {
  const owed = await tx.refund.findMany({ where: { sellerOrderId, status: { in: OWED } }, include: { items: true } });
  const items = new Map<string, { qty: number; kobo: bigint }>();
  for (const r of owed) {
    for (const i of r.items) {
      const cur = items.get(i.orderItemId) ?? { qty: 0, kobo: 0n };
      items.set(i.orderItemId, { qty: cur.qty + Number(i.qty), kobo: cur.kobo + i.amountKobo });
    }
  }
  return {
    amountKobo: owed.reduce((a, r) => a + r.amountKobo, 0n),
    commissionKobo: owed.reduce((a, r) => a + r.commissionReturnedKobo, 0n),
    platformDiscountKobo: owed.reduce((a, r) => a + r.platformDiscountReturnedKobo, 0n),
    deliveryRefunded: owed.some((r) => r.includesDelivery),
    items,
  };
}

/** The successful charge an order was paid with (not a stray second payment). */
async function orderPayment(tx: Tx, orderId: string) {
  const stray = await tx.refund.findMany({ where: { orderId, reason: "payment_problem" }, select: { paymentId: true } });
  const p = await tx.payment.findFirst({
    where: { orderId, status: "success", provider: { not: "pay_on_delivery" }, id: { notIn: stray.map((s) => s.paymentId) } },
    orderBy: { paidAt: "asc" },
  });
  if (!p) throw new RefundError("This order wasn't paid online, so there's nothing to refund through TownMart.");
  return p;
}

export type RequestInput = {
  sellerOrderId: string;
  /** Set when a seller is acting: the order must be theirs. */
  businessId?: string;
  origin: RefundOrigin;
  requestedBy: string | null;
  reason: Exclude<RefundReason, "payment_problem">;
  details?: string | null;
  evidenceKeys?: string[];
  /** Order lines and quantities; omit for "everything left". */
  items?: { orderItemId: string; qty: number }[];
  includeDelivery: boolean;
  /** For a part refund of a booking (late cancellation): the amount instead of the lines' full price. */
  amountKobo?: bigint;
  respondBy: Date | null;
};

/** Opens a refund request (status requested). Checks quantities against what's left. */
export async function createRefundRequest(tx: Tx, p: RequestInput): Promise<Refund> {
  const so = await lockSellerOrder(tx, p.sellerOrderId, p.businessId);
  if (so.payOnDelivery) throw new RefundError("This order was paid on delivery. Ask the seller, or open a dispute from your order page.");
  const order = await tx.order.findUniqueOrThrow({ where: { id: so.orderId } });
  if (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded") throw new RefundError("This order hasn't been paid for.");
  if (await tx.refund.findFirst({ where: { sellerOrderId: so.id, status: "requested" }, select: { id: true } })) {
    throw new RefundError("There's already a refund request waiting for an answer on this order.");
  }
  const payment = await orderPayment(tx, order.id);
  const before = await refundedSoFar(tx, so.id);
  const lines = await tx.orderItem.findMany({ where: { sellerOrderId: so.id }, include: { booking: { select: { balanceKobo: true } } } });

  const wanted = p.items ?? lines.map((l) => ({ orderItemId: l.id, qty: Number(l.qty) - (before.items.get(l.id)?.qty ?? 0) })).filter((i) => i.qty > 1e-9);
  const items: { orderItemId: string; qty: number; amountKobo: bigint }[] = [];
  for (const w of wanted) {
    const line = lines.find((l) => l.id === w.orderItemId);
    if (!line) throw new RefundError("That item isn't part of this order.");
    const done = before.items.get(line.id) ?? { qty: 0, kobo: 0n };
    const paid = itemPaidOnline(line, line.booking?.balanceKobo ?? 0n);
    items.push({ orderItemId: line.id, qty: w.qty, amountKobo: itemRefund({ paidKobo: paid, itemQty: Number(line.qty), refundedQty: done.qty, refundedKobo: done.kobo, qty: w.qty }) });
  }
  const delivery = p.includeDelivery && !before.deliveryRefunded ? so.deliveryKobo : 0n;
  const left = paidOnline(so) - before.amountKobo;
  let requested = p.amountKobo ?? items.reduce((a, i) => a + i.amountKobo, 0n) + delivery;
  if (requested > left) requested = left;
  if (requested <= 0n) throw new RefundError("There's nothing left to refund on this order.");

  const n = await nextRefundNumber(tx);
  return tx.refund.create({
    data: {
      refundNumber: n,
      orderId: order.id,
      sellerOrderId: so.id,
      businessId: so.businessId,
      paymentId: payment.id,
      origin: p.origin,
      requestedBy: p.requestedBy,
      reason: p.reason,
      details: p.details ?? null,
      evidenceKeys: p.evidenceKeys ?? [],
      requestedKobo: requested,
      amountKobo: requested,
      includesDelivery: delivery > 0n,
      respondBy: p.respondBy,
      items: { create: items.map((i) => ({ orderItemId: i.orderItemId, businessId: so.businessId, qty: new Prisma.Decimal(i.qty), amountKobo: i.amountKobo })) },
    },
  });
}

export type ApproveInput = {
  refundId: string;
  businessId?: string;
  decidedBy: string | null;
  /** Approve less than was asked (never more than is left). */
  amountKobo?: bigint;
  /** Lines whose goods are back with the seller (or never left) and go back on sale. */
  restockItemIds?: string[];
  response?: string | null;
  now?: Date;
};

/**
 * Approves a requested refund: fixes the split, writes the ledger (the money
 * is now owed to the customer), puts returned goods back on sale and moves
 * the seller order on if nothing of it is left. The provider refund is sent
 * after the transaction commits (sendRefund).
 */
export async function approveRefund(tx: Tx, p: ApproveInput): Promise<Refund> {
  const now = p.now ?? new Date();
  const r = await lockRefund(tx, p.refundId, p.businessId);
  if (r.status !== "requested") throw new RefundError("This refund has already been decided.");
  if (!r.sellerOrderId || !r.businessId) throw new RefundError("Payment refunds are approved when they're created.");
  const so = await lockSellerOrder(tx, r.sellerOrderId);
  const order = await tx.order.findUniqueOrThrow({ where: { id: so.orderId }, include: { sellerOrders: true } });
  const before = await refundedSoFar(tx, so.id);
  const paid = paidOnline(so);
  const left = paid - before.amountKobo;
  const amount = p.amountKobo !== undefined ? p.amountKobo : r.requestedKobo;
  if (amount <= 0n) throw new RefundError("Enter an amount to refund.");
  if (amount > left) throw new RefundError(`Only ${formatPrice(left)} is left to refund on this order.`);
  const split = refundSplit(so, before, amount);

  // The service fee comes back with the refund that leaves nothing of the order paid for.
  const orderPaid = order.sellerOrders.filter((s) => !s.payOnDelivery).reduce((a, s) => a + paidOnline(s), 0n);
  const orderOwed = await tx.refund.findMany({ where: { orderId: order.id, status: { in: OWED }, sellerOrderId: { not: null } }, select: { amountKobo: true, feeKobo: true, vatKobo: true } });
  const fees = feeRefund({
    paidGoodsKobo: orderPaid,
    refundedGoodsKobo: orderOwed.reduce((a, x) => a + x.amountKobo, 0n),
    thisRefundKobo: amount,
    serviceFeeKobo: order.serviceFeeKobo,
    vatKobo: order.vatKobo,
    feeRefundedKobo: orderOwed.reduce((a, x) => a + x.feeKobo + x.vatKobo, 0n),
  });
  const debitFrom = so.escrowReleasedAt ? "available" : "escrow";

  const updated = await tx.refund.update({
    where: { id: r.id },
    data: {
      status: "approved",
      amountKobo: amount,
      feeKobo: fees.feeKobo,
      vatKobo: fees.vatKobo,
      ...split,
      debitedFrom: debitFrom,
      response: p.response ?? r.response,
      decidedBy: p.decidedBy,
      decidedAt: now,
    },
  });
  await postLedgerTransaction(tx, {
    kind: "refund_approved",
    referenceType: "refund",
    referenceId: r.id,
    memo: `${r.refundNumber} for ${so.orderNumber}`,
    postings: refundApprovedPostings({ businessId: so.businessId, debitFrom, amountKobo: amount, ...split, ...fees }),
  });

  // Goods back on sale.
  const restock = new Set(p.restockItemIds ?? []);
  const items = await tx.refundItem.findMany({ where: { refundId: r.id }, include: { orderItem: { select: { variantId: true } } } });
  for (const i of items) {
    if (!restock.has(i.orderItemId) || !i.orderItem.variantId) continue;
    await adjustStock(tx, { businessId: i.businessId, variantId: i.orderItem.variantId, change: i.qty, reason: "refund_restock", referenceType: "refund", referenceId: r.id, actorUserId: p.decidedBy, note: r.refundNumber });
    await tx.refundItem.update({ where: { id: i.id }, data: { restock: true, restockedAt: now } });
  }

  // Nothing of this seller's part left: it's cancelled (not handed over yet) or refunded.
  if (before.amountKobo + amount === paid && so.deliveryMethod !== "none") {
    const to = (["paid", "processing", "ready_for_pickup"] as const).includes(so.status as "paid") ? "cancelled" : (["shipped", "delivered", "completed"] as const).includes(so.status as "shipped") ? "refunded" : null;
    if (to) {
      await tx.sellerOrder.update({ where: { id: so.id }, data: { status: to } });
      const why = r.details ? `: ${r.details}` : "";
      await recordStatus(tx, { sellerOrderId: so.id, businessId: so.businessId, from: so.status, to, actorUserId: p.decidedBy, note: to === "cancelled" ? `Cancelled and refunded in full (${r.refundNumber})${why}` : `Refunded in full (${r.refundNumber})` });
      if (to === "cancelled") {
        const live = await tx.booking.findMany({ where: { sellerOrderId: so.id, status: { in: ["requested", "confirmed"] } } });
        for (const b of live) await moveBooking(tx, b, "cancelled", "Order cancelled and refunded", p.decidedBy, { cancelReason: "Order cancelled" });
      }
      const open = await tx.sellerOrder.count({ where: { orderId: so.orderId, status: { notIn: ["cancelled"] } } });
      if (open === 0) await tx.order.update({ where: { id: so.orderId }, data: { cancelledAt: now, cancelReason: "Cancelled and refunded" } });
    }
  }
  return updated;
}

export async function rejectRefund(tx: Tx, p: { refundId: string; businessId?: string; decidedBy: string | null; response: string; now?: Date }): Promise<Refund> {
  const r = await lockRefund(tx, p.refundId, p.businessId);
  if (r.status !== "requested") throw new RefundError("This refund has already been decided.");
  return tx.refund.update({ where: { id: r.id }, data: { status: "rejected", response: p.response, decidedBy: p.decidedBy, decidedAt: p.now ?? new Date() } });
}

/** A refund TownMart or the seller starts and approves in one go (cancellations). */
export async function refundNow(tx: Tx, p: Omit<RequestInput, "respondBy"> & { restockItemIds?: "all" | string[]; response?: string | null }): Promise<Refund> {
  const req = await createRefundRequest(tx, { ...p, respondBy: null });
  const items = p.restockItemIds === "all" ? (await tx.refundItem.findMany({ where: { refundId: req.id }, select: { orderItemId: true } })).map((i) => i.orderItemId) : p.restockItemIds;
  return approveRefund(tx, { refundId: req.id, decidedBy: p.requestedBy, restockItemIds: items, response: p.response, amountKobo: p.amountKobo });
}

/**
 * A payment that couldn't be applied to its order (paid twice, the wrong
 * amount, or after the items sold out) is refunded in full. Idempotent per
 * payment: webhooks and the shopper's return can both report it.
 */
export async function refundUnappliedPayment(tx: Tx, p: { paymentId: string; amountKobo: bigint; why: string }): Promise<Refund | null> {
  const existing = await tx.refund.findFirst({ where: { paymentId: p.paymentId, reason: "payment_problem" } });
  if (existing) return null;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: p.paymentId }, include: { order: { select: { orderNumber: true } } } });
  if (p.amountKobo <= 0n) return null;
  const n = await nextRefundNumber(tx);
  const r = await tx.refund.create({
    data: {
      refundNumber: n,
      orderId: payment.orderId,
      paymentId: payment.id,
      origin: "system",
      reason: "payment_problem",
      details: p.why,
      requestedKobo: p.amountKobo,
      amountKobo: p.amountKobo,
      status: "approved",
      decidedAt: new Date(),
    },
  });
  await postLedgerTransaction(tx, {
    kind: "payment_unapplied",
    referenceType: "refund",
    referenceId: r.id,
    memo: `${r.refundNumber}: ${p.why} (${payment.order.orderNumber})`,
    postings: unappliedPaymentPostings(payment.provider, p.amountKobo),
  });
  return r;
}

/** Marks a refund paid out by the provider, writes the ledger and updates the order's payment status. */
async function completeRefund(tx: Tx, refundId: string, result: ProviderRefund, now: Date): Promise<void> {
  const r = await lockRefund(tx, refundId);
  if (r.status === "completed") return;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: r.paymentId } });
  await tx.refund.update({
    where: { id: r.id },
    data: { status: "completed", completedAt: now, providerStatus: result.status, providerRefundReference: result.providerRefundReference ?? r.providerRefundReference, lastError: null },
  });
  await postLedgerTransaction(tx, {
    kind: "refund_paid",
    referenceType: "refund",
    referenceId: r.id,
    memo: `${r.refundNumber} paid back via ${payment.provider}`,
    postings: refundPaidPostings(payment.provider, r.amountKobo + r.feeKobo + r.vatKobo),
  });
  if (r.reason === "payment_problem") {
    await tx.payment.update({ where: { id: payment.id }, data: { status: "reversed" } });
    return;
  }
  const order = await tx.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { sellerOrders: true } });
  if (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded") return;
  const paid = order.sellerOrders.filter((s) => !s.payOnDelivery).reduce((a, s) => a + paidOnline(s), 0n);
  const done = await tx.refund.aggregate({ where: { orderId: order.id, status: "completed", sellerOrderId: { not: null } }, _sum: { amountKobo: true } });
  const refunded = done._sum.amountKobo ?? 0n;
  await tx.order.update({ where: { id: order.id }, data: { paymentStatus: refunded >= paid ? "refunded" : "partially_refunded" } });
}

async function failRefund(refundId: string, message: string, providerStatus: string | null): Promise<void> {
  await withSystemContext((tx) => tx.refund.update({ where: { id: refundId }, data: { status: "failed", lastError: message.slice(0, 500), providerStatus } }));
}

/**
 * Sends an approved (or failed, on retry) refund to the payment provider. The
 * provider call happens outside any database transaction; the refund is
 * marked processing first so two workers can't send it twice.
 */
export async function sendRefund(refundId: string, now = new Date()): Promise<RefundStatus | null> {
  const claimed = await withSystemContext(async (tx) => {
    const r = await lockRefund(tx, refundId);
    if (r.status !== "approved" && r.status !== "failed") return null;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: r.paymentId } });
    await tx.refund.update({ where: { id: r.id }, data: { status: "processing", attempts: { increment: 1 }, sentAt: now, lastError: null } });
    return { r, payment };
  });
  if (!claimed) return null;
  const { r, payment } = claimed;
  let result: ProviderRefund;
  try {
    result = await paymentProvider(payment.provider as ProviderName).refund({
      paymentReference: payment.providerReference,
      amountKobo: r.amountKobo + r.feeKobo + r.vatKobo,
      refundNumber: r.refundNumber,
      verification: payment.rawVerification,
    });
  } catch (err) {
    // Unknown outcome (timeout, outage): left processing without a provider reference for the sync job to sort out.
    logger.error({ err, refund: r.refundNumber }, "provider refund call failed");
    await withSystemContext((tx) => tx.refund.update({ where: { id: r.id }, data: { lastError: err instanceof Error ? err.message.slice(0, 500) : "Provider error" } }));
    return "processing";
  }
  if (result.status === "failed") {
    await failRefund(r.id, result.message ?? "The provider declined the refund", result.status);
    return "failed";
  }
  if (result.status === "completed") {
    await withSystemContext((tx) => completeRefund(tx, r.id, result, new Date()));
    return "completed";
  }
  await withSystemContext((tx) => tx.refund.update({ where: { id: r.id }, data: { providerRefundReference: result.providerRefundReference, providerStatus: result.status } }));
  return "processing";
}

/** Asks the provider about a refund it's still working on. */
export async function syncRefund(refundId: string): Promise<RefundStatus | null> {
  const r = await withSystemContext((tx) => tx.refund.findUnique({ where: { id: refundId }, include: { payment: true } }));
  if (!r || r.status !== "processing" || !r.providerRefundReference) return r?.status ?? null;
  const result = await paymentProvider(r.payment.provider as ProviderName).refundStatus(r.providerRefundReference);
  if (result.status === "completed") {
    await withSystemContext((tx) => completeRefund(tx, r.id, result, new Date()));
    return "completed";
  }
  if (result.status === "failed") {
    await failRefund(r.id, result.message ?? "The provider couldn't complete the refund", result.status);
    return "failed";
  }
  return "processing";
}

/**
 * Worker job: sends approved refunds, checks on ones the provider is still
 * processing, and flags ones whose provider call never returned so a person
 * checks the provider dashboard before retrying.
 */
export async function processRefunds(now = new Date()): Promise<{ sent: number; completed: number; failed: number }> {
  const due = await withSystemContext((tx) =>
    tx.refund.findMany({
      where: {
        OR: [
          { status: "approved" },
          { status: "processing", providerRefundReference: { not: null }, sentAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
          { status: "processing", providerRefundReference: null, sentAt: { lt: new Date(now.getTime() - 30 * 60_000) } },
        ],
      },
      select: { id: true, status: true, providerRefundReference: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
  );
  const out = { sent: 0, completed: 0, failed: 0 };
  for (const r of due) {
    try {
      let status: RefundStatus | null;
      if (r.status === "approved") {
        out.sent++;
        status = await sendRefund(r.id, now);
      } else if (r.providerRefundReference) {
        status = await syncRefund(r.id);
      } else {
        await failRefund(r.id, "The provider didn't confirm this refund. Check the provider dashboard before retrying.", null);
        status = "failed";
      }
      if (status === "completed") {
        out.completed++;
        await enqueueNotice({ type: "refund.update", refundId: r.id, status });
      }
      if (status === "failed") out.failed++;
    } catch (err) {
      logger.error({ err, refundId: r.id }, "refund processing failed");
    }
  }
  return out;
}

/** Webhook hint: a provider says something happened to refunds of a charge. */
export async function syncRefundsForPayment(paymentReference: string): Promise<void> {
  const refunds = await withSystemContext((tx) => tx.refund.findMany({ where: { status: "processing", payment: { providerReference: paymentReference } }, select: { id: true } }));
  for (const r of refunds) {
    if ((await syncRefund(r.id)) === "completed") await enqueueNotice({ type: "refund.update", refundId: r.id, status: "completed" });
  }
}
