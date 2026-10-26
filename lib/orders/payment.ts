import { Prisma } from "@prisma/client";
import { claimSlot, SlotTakenError } from "@/lib/bookings/schedule";
import { moveBooking, startingStatus } from "@/lib/bookings/status";
import { adjustStock, CatalogueError } from "@/lib/catalogue/products";
import { randomToken } from "@/lib/crypto";
import { withSystemContext, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { paymentCapturedPostings } from "@/lib/ledger/entries";
import { postLedgerTransaction } from "@/lib/ledger/post";
import { logger } from "@/lib/logger";
import { paymentProvider, paymentProviderOrder, PaymentProviderError, type ProviderName, type VerifiedPayment } from "@/lib/payments";
import { enqueueOrderEvent } from "@/lib/queue";
import { writeRedemptions } from "./place";
import { moveSellerOrders } from "./status";

export class PaymentError extends Error {}

/**
 * Starts (or restarts) an online payment for an unpaid order: records a new
 * payment attempt with a fresh reference and returns the provider's page.
 * Tries the fallback provider if the primary can't start a payment.
 */
export async function startOnlinePayment(orderId: string, accessToken: string): Promise<{ redirectUrl: string }> {
  const order = await withSystemContext((tx) => tx.order.findUnique({ where: { id: orderId } }));
  if (!order || order.paymentStatus !== "unpaid" || order.cancelledAt) throw new PaymentError("This order can't be paid for any more.");
  if (order.paymentDueAt && order.paymentDueAt <= new Date()) throw new PaymentError("The time to pay for this order has run out, so its items went back on sale. Please order again.");

  const callback = `${env().APP_URL}/checkout/complete/${order.orderNumber}?t=${encodeURIComponent(accessToken)}`;
  let lastError: unknown;
  for (const provider of paymentProviderOrder()) {
    const reference = `${order.orderNumber}-${randomToken(6).replace(/[^A-Za-z0-9]/g, "x")}`;
    await withSystemContext(async (tx) => {
      await tx.payment.create({ data: { orderId: order.id, provider, providerReference: reference, amountKobo: order.totalKobo } });
      await tx.order.update({ where: { id: order.id }, data: { paymentMethod: provider } });
    });
    try {
      return await paymentProvider(provider).start({
        reference,
        amountKobo: order.totalKobo,
        email: order.contactEmail,
        name: order.customerName,
        callbackUrl: callback,
        description: `TownMart order ${order.orderNumber}`,
      });
    } catch (err) {
      lastError = err;
      logger.error({ err, provider, orderNumber: order.orderNumber }, "payment start failed");
      await withSystemContext((tx) => tx.payment.update({ where: { providerReference: reference }, data: { status: "failed" } }));
    }
  }
  throw new PaymentError(lastError instanceof PaymentProviderError ? "We couldn't reach the payment provider. Please try again in a moment." : "We couldn't start the payment. Please try again.");
}

type ConfirmResult = "paid" | "already_paid" | "not_paid" | "needs_attention";

/** Locks a row so concurrent webhooks, callbacks and the expiry job take turns. */
async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { sellerOrders: true } });
}

/**
 * Takes stock and booking times again for an order whose hold had expired
 * (payment arrived late). Returns false, having changed nothing that commits,
 * if any of it has gone: the caller rolls back to a savepoint.
 */
async function retakeHolds(tx: Tx, orderId: string): Promise<boolean> {
  const held = await tx.stockReservation.findMany({ where: { orderId, status: "released" }, orderBy: { variantId: "asc" } });
  try {
    for (const r of held) {
      await adjustStock(tx, { businessId: r.businessId, variantId: r.variantId, change: r.qty.negated(), reason: "reservation", referenceType: "order", referenceId: orderId, note: "Late payment" });
    }
    const bookings = await tx.booking.findMany({
      where: { orderId, status: "cancelled", holdExpiresAt: { not: null } },
      orderBy: [{ serviceId: "asc" }, { startsAt: "asc" }],
    });
    for (const b of bookings) {
      // The time may have been taken (or passed) meanwhile; pick a free place again. The lead time no longer applies.
      const place = await claimSlot(tx, { serviceId: b.serviceId, startsAt: b.startsAt, durationMinutes: (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000, leadMinutes: 0, now: new Date(), ignoreBookingId: b.id });
      await tx.booking.update({ where: { id: b.id }, data: { slotNo: place.slotNo, capacity: place.capacity } });
      await moveBooking(tx, b, "held", "Late payment: time taken again", null, { cancelReason: null });
    }
  } catch (err) {
    if (err instanceof CatalogueError || err instanceof SlotTakenError) return false;
    throw err;
  }
  await tx.stockReservation.updateMany({ where: { orderId, status: "released" }, data: { status: "held" } });
  return true;
}

/** Paid: held bookings go to the provider to confirm, or straight to confirmed. */
async function confirmHeldBookings(tx: Tx, orderId: string, note: string): Promise<void> {
  const held = await tx.booking.findMany({ where: { orderId, status: "held" }, include: { service: { select: { requiresConfirmation: true } } } });
  for (const b of held) await moveBooking(tx, b, startingStatus(b.service.requiresConfirmation), note, null, { holdExpiresAt: null });
}

/**
 * Applies a verified payment to its order. Idempotent: webhooks, the
 * shopper's return from the payment page and the expiry job may all call it
 * for the same payment; only the first success has any effect.
 *
 * Never call it with data from a webhook body: `verified` must come from the
 * provider's verify API.
 */
/**
 * Applies a verified payment inside the caller's system-scope transaction.
 * Returns the order id once it's newly paid, or what happened instead.
 * The demo seed uses it directly; everything else goes through applyVerifiedPayment.
 */
export async function applyVerifiedPaymentTx(tx: Tx, reference: string, verified: VerifiedPayment): Promise<{ orderId: string } | Exclude<ConfirmResult, "paid">> {
  const payment = await tx.payment.findUnique({ where: { providerReference: reference } });
  if (!payment) throw new PaymentError(`Unknown payment reference ${reference}`);
  const order = await lockOrder(tx, payment.orderId);
  const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
  if (current.status === "success") return "already_paid" as const;

  if (verified.status !== "success") {
    if (verified.status === "failed" || verified.status === "abandoned") {
      await tx.payment.update({ where: { id: payment.id }, data: { status: verified.status, rawVerification: verified.raw as Prisma.InputJsonValue } });
    }
    return "not_paid" as const;
  }

  // Amount and currency must match exactly; anything else is investigated, not accepted.
  if (verified.amountKobo !== current.amountKobo || verified.currency !== "NGN") {
    await tx.payment.update({ where: { id: payment.id }, data: { status: "failed", rawVerification: verified.raw as Prisma.InputJsonValue } });
    logger.error({ reference, expected: current.amountKobo.toString(), got: verified.amountKobo.toString(), currency: verified.currency }, "payment amount mismatch");
    return "needs_attention" as const;
  }

  await tx.payment.update({
    where: { id: payment.id },
    data: { status: "success", channel: verified.channel, paidAt: verified.paidAt ?? new Date(), rawVerification: verified.raw as Prisma.InputJsonValue },
  });

  if (order.paymentStatus === "paid") {
    // A second successful attempt for an already-paid order: money to give back (Phase 5 refunds).
    logger.error({ reference, orderNumber: order.orderNumber }, "duplicate payment for a paid order: refund needed");
    return "needs_attention" as const;
  }
  if (order.cancelledAt) {
    await tx.$executeRaw`SAVEPOINT retake`;
    if (!(await retakeHolds(tx, order.id))) {
      // Paid after the hold expired and the stock or time has gone: the order stays cancelled and is refunded.
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT retake`;
      logger.error({ reference, orderNumber: order.orderNumber }, "late payment for an order whose stock or booking time has gone: refund needed");
      return "needs_attention" as const;
    }
    await tx.$executeRaw`RELEASE SAVEPOINT retake`;
  }

  const now = new Date();
  await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "paid", paidAt: now, paymentMethod: current.provider, cancelledAt: null, cancelReason: null } });
  await moveSellerOrders(tx, order.id, ["pending_payment", "cancelled"], "paid", `Payment received (${current.provider})`);
  await tx.stockReservation.updateMany({ where: { orderId: order.id, status: "held" }, data: { status: "converted" } });
  await confirmHeldBookings(tx, order.id, `Payment received (${current.provider})`);
  await writeRedemptions(tx, order.id, order.userId);
  await postLedgerTransaction(tx, {
    kind: "payment_captured",
    referenceType: "order",
    referenceId: order.id,
    memo: `${order.orderNumber} via ${current.provider}`,
    postings: paymentCapturedPostings({
      provider: current.provider,
      totalKobo: order.totalKobo,
      serviceFeeKobo: order.serviceFeeKobo,
      vatKobo: order.vatKobo,
      sellers: order.sellerOrders.map((s) => ({ businessId: s.businessId, platformDiscountKobo: s.platformDiscountKobo, commissionKobo: s.commissionKobo, sellerNetKobo: s.sellerNetKobo, payLaterKobo: s.payLaterKobo })),
    }),
  });
  return { orderId: order.id };
}

export async function applyVerifiedPayment(reference: string, verified: VerifiedPayment): Promise<ConfirmResult> {
  const result = await withSystemContext((tx) => applyVerifiedPaymentTx(tx, reference, verified));
  if (typeof result === "string") return result;
  await enqueueOrderEvent({ kind: "order.confirmed", orderId: result.orderId });
  return "paid";
}

/** Asks the provider about a payment and applies the answer. */
export async function verifyAndApply(reference: string): Promise<ConfirmResult> {
  const payment = await withSystemContext((tx) => tx.payment.findUnique({ where: { providerReference: reference }, select: { provider: true } }));
  if (!payment || payment.provider === "pay_on_delivery") return "not_paid";
  const verified = await paymentProvider(payment.provider as ProviderName).verify(reference);
  return applyVerifiedPayment(reference, verified);
}

/**
 * Processes one stored webhook delivery (worker job). The event is only a
 * hint: the payment is confirmed by calling the provider's verify API.
 */
export async function processPaymentEvent(eventId: string): Promise<void> {
  const event = await withSystemContext((tx) => tx.paymentEvent.findUnique({ where: { id: eventId } }));
  if (!event || event.processedAt || !event.signatureValid) return;
  let error: string | null = null;
  try {
    if (event.reference) {
      const known = await withSystemContext((tx) => tx.payment.findUnique({ where: { providerReference: event.reference! }, select: { id: true } }));
      if (known) await verifyAndApply(event.reference);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await withSystemContext((tx) => tx.paymentEvent.update({ where: { id: event.id }, data: error ? { error } : { processedAt: new Date(), error: null } }));
  }
}

/**
 * Cancels online orders whose payment window has passed and puts their stock
 * and booking times back. Each order is checked with the provider first, in case a payment went
 * through but its webhook hasn't arrived.
 */
export async function expireUnpaidOrders(now = new Date()): Promise<{ expired: number; paidLate: number }> {
  const due = await withSystemContext((tx) =>
    tx.order.findMany({
      where: { paymentStatus: "unpaid", cancelledAt: null, paymentDueAt: { lt: now } },
      select: { id: true, payments: { where: { status: "initiated" }, select: { providerReference: true } } },
      take: 200,
    }),
  );
  let expired = 0;
  let paidLate = 0;
  for (const o of due) {
    let paid = false;
    for (const p of o.payments) {
      try {
        paid = (await verifyAndApply(p.providerReference)) === "paid" || paid;
      } catch (err) {
        logger.warn({ err, reference: p.providerReference }, "verify before expiry failed");
      }
    }
    if (paid) {
      paidLate++;
      continue;
    }
    const did = await withSystemContext(async (tx) => {
      const order = await lockOrder(tx, o.id);
      if (order.paymentStatus !== "unpaid" || order.cancelledAt) return false;
      const held = await tx.stockReservation.findMany({ where: { orderId: order.id, status: "held" }, orderBy: { variantId: "asc" } });
      for (const r of held) {
        await adjustStock(tx, { businessId: r.businessId, variantId: r.variantId, change: r.qty, reason: "release", referenceType: "order", referenceId: order.id, note: `Payment not received for ${order.orderNumber}` });
      }
      await tx.stockReservation.updateMany({ where: { orderId: order.id, status: "held" }, data: { status: "released" } });
      // Held booking times are freed; holdExpiresAt stays set, marking them as cancelled for non-payment.
      const heldBookings = await tx.booking.findMany({ where: { orderId: order.id, status: "held" } });
      for (const b of heldBookings) await moveBooking(tx, b, "cancelled", "Payment not received in time", null, { cancelReason: "Payment not received in time" });
      await tx.payment.updateMany({ where: { orderId: order.id, status: "initiated" }, data: { status: "abandoned" } });
      await tx.order.update({ where: { id: order.id }, data: { cancelledAt: now, cancelReason: "Payment not received in time" } });
      await moveSellerOrders(tx, order.id, ["pending_payment"], "cancelled", "Payment not received in time");
      return true;
    });
    if (did) expired++;
  }
  return { expired, paidLate };
}
