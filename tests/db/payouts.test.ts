import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelBooking } from "@/lib/bookings/manage";
import { computeCheckout } from "@/lib/checkout/compute";
import { prisma, withRls, withSystemContext } from "@/lib/db";
import { escalateOverdueRefunds, openDispute, resolveDispute } from "@/lib/disputes/core";
import { advanceSellerOrder, markCashCollected } from "@/lib/fulfilment/orders";
import { applyVerifiedPayment } from "@/lib/orders/payment";
import { placeOrder, type PlacedOrder } from "@/lib/orders/place";
import type { VerifiedPayment } from "@/lib/payments";
import { FakePaymentProvider } from "@/lib/payments/fake";
import { FakeTransfers } from "@/lib/payments/transfers";
import { businessBalances } from "@/lib/payouts/balances";
import { escrowHeld, releaseSellerOrder } from "@/lib/payouts/escrow";
import { createPayout, sendPayout } from "@/lib/payouts/payouts";
import { loadSellerPayouts } from "@/lib/payouts/seller-view";
import { buildStatement, lagosMonth, statementCsv } from "@/lib/payouts/statement";
import { cancelPaidSellerOrder } from "@/lib/refunds/cancel";
import { approveRefund, createRefundRequest, processRefunds, rejectRefund, RefundError } from "@/lib/refunds/core";
import { paidOnline } from "@/lib/refunds/math";
import { listSellerRefunds, loadSellerRefund } from "@/lib/refunds/seller-view";
import { createUser, deleteMoneyTrail, deleteUsers, lagosIkeja, owner } from "./helpers";

/**
 * Phase 5 at the database layer: refunds take back exactly what each side
 * got, escrow is released once and never while a refund or dispute is open,
 * payouts can't pay the same balance twice and a failed transfer comes back,
 * the ledger balances after every flow, and refunds, disputes and payouts
 * stay with their owners under RLS.
 */

type Seller = { userId: string; businessId: string; productId: string; variantId: string };

const tag = randomUUID().slice(0, 8);
const users: string[] = [];
const carts: string[] = [];
const sellers: Seller[] = [];
let categoryId: string;
let shop: Seller;
let other: Seller;
let cod: Seller;
let provider: { userId: string; businessId: string; serviceId: string };
let buyer: { id: string; email: string };
let stranger: { id: string };

const asSystem = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
    return fn(tx);
  });
const sys = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => withSystemContext(fn, { timeout: 60_000, maxWait: 60_000 });
const asSeller = <T>(s: { userId: string; businessId: string }, fn: (tx: Prisma.TransactionClient) => Promise<T>) => withRls({ userId: s.userId, businessId: s.businessId }, fn);

async function business(label: string, type: "merchant" | "service_provider", payOnDelivery: boolean) {
  const user = await createUser(label);
  users.push(user.id);
  const { stateId, lgaId } = await lagosIkeja();
  return asSystem((tx) =>
    tx.business.create({
      data: {
        ownerUserId: user.id,
        type,
        name: `${label} ${tag}`,
        slug: `${label}-${tag}`,
        email: `${label}-${tag}@test.townmart.local`,
        phoneEncrypted: "v1.k1.test.test.test",
        phoneHash: `${label}-${tag}`,
        addressEncrypted: "v1.k1.test.test.test",
        city: "Ikeja",
        stateId,
        lgaId,
        status: "approved",
        policy: { create: { acceptsPayOnDelivery: payOnDelivery, deliveryOptions: { delivery: true, pickup: true } } },
        payoutAccount: { create: { bankCode: "058", bankName: "Guaranty Trust Bank", accountNumberLast4: "4321", accountName: label.toUpperCase(), providerRecipientCode: `RCP_test_${label}`, verifiedAt: new Date() } },
      },
    }),
  ).then((b) => ({ userId: user.id, businessId: b.id }));
}

async function seller(label: string, priceKobo: bigint, payOnDelivery = false): Promise<Seller> {
  const b = await business(label, "merchant", payOnDelivery);
  const p = await asSystem(async (tx) => {
    const product = await tx.product.create({ data: { businessId: b.businessId, categoryId, title: `${label} item ${tag}`, slug: `${label}-item-${tag}`, basePriceKobo: priceKobo, status: "active" } });
    const v = await tx.productVariant.create({ data: { productId: product.id, businessId: b.businessId, sku: `${label}-${tag}`, priceKobo, stockQty: 100, isDefault: true } });
    return { productId: product.id, variantId: v.id };
  });
  const s = { ...b, ...p };
  sellers.push(s);
  return s;
}

type Line = { variantId: string; businessId: string; qty: number } | { serviceId: string; businessId: string; startsAt: Date };

async function place(lines: Line[], payment: "online" | "pay_on_delivery" = "online"): Promise<PlacedOrder> {
  await owner.cart.deleteMany({ where: { userId: buyer.id } });
  const cart = await owner.cart.create({
    data: {
      userId: buyer.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      items: {
        create: lines.map((l) =>
          "variantId" in l ? { variantId: l.variantId, businessId: l.businessId, qty: l.qty } : { serviceId: l.serviceId, businessId: l.businessId, bookingStartsAt: l.startsAt, atProvider: true, qty: 1 },
        ),
      },
    },
  });
  carts.push(cart.id);
  const { stateId, lgaId } = await lagosIkeja();
  const quote = await sys((tx) => computeCheckout(tx, { cartId: cart.id, userId: buyer.id, address: { stateId, lgaId } }));
  return sys((tx) =>
    placeOrder(tx, {
      cartId: cart.id,
      userId: buyer.id,
      accountEmail: buyer.email,
      accountName: "Ada Obi",
      ipHash: "test",
      data: {
        email: "",
        address: { recipientName: "Ada Obi", phone: "08031234567", line1: "12 Allen Avenue", line2: "", landmark: "", city: "Ikeja", stateId, lgaId },
        addressId: "",
        saveAddress: false,
        methods: {},
        payment,
        acceptTerms: true,
        marketingConsent: false,
        expectedTotalKobo: quote.quote.totalKobo.toString(),
      },
    }),
  );
}

const verified = (reference: string, amountKobo: bigint): VerifiedPayment => ({ reference, status: "success", amountKobo, currency: "NGN", channel: "card", paidAt: new Date(), raw: {} });

/** Places an online order and pays for it. */
async function paid(lines: Line[]) {
  const placed = await place(lines);
  const p = await owner.payment.create({ data: { orderId: placed.orderId, provider: "fake", providerReference: `ref-${randomUUID()}`, amountKobo: placed.totalKobo } });
  expect(await applyVerifiedPayment(p.providerReference, verified(p.providerReference, placed.totalKobo))).toBe("paid");
  const sos = await owner.sellerOrder.findMany({ where: { orderId: placed.orderId }, include: { items: true } });
  return { placed, payment: p, sos };
}

async function deliver(s: { userId: string; businessId: string }, sellerOrderId: string, now = new Date()) {
  for (const to of ["processing", "shipped", "delivered"] as const) {
    await asSeller(s, (tx) => advanceSellerOrder(tx, { sellerOrderId, businessId: s.businessId, to, actorUserId: s.userId, escrowReleaseDays: 3, now }));
  }
}

const stock = async (s: Seller) => (await owner.productVariant.findUniqueOrThrow({ where: { id: s.variantId } })).stockQty.toNumber();
const balances = (businessId: string) => sys((tx) => businessBalances(tx, businessId));

/** Every ledger transaction about these orders, refunds and payouts balances. */
async function expectLedgerBalanced() {
  const rows = await owner.$queryRaw<{ id: string; d: bigint; c: bigint }[]>`
    SELECT transaction_id AS id, sum(debit_kobo)::bigint AS d, sum(credit_kobo)::bigint AS c FROM ledger_entries GROUP BY transaction_id HAVING sum(debit_kobo) <> sum(credit_kobo)`;
  expect(rows).toEqual([]);
}

function tomorrowAt(hour: number): Date {
  const lagosToday = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  return new Date(new Date(`${lagosToday}T${String(hour).padStart(2, "0")}:00:00+01:00`).getTime() + 86_400_000);
}

beforeAll(async () => {
  categoryId = (await owner.category.findFirstOrThrow({ where: { kind: "product", isActive: true, parentId: { not: null } } })).id;
  shop = await seller("po-shop", 300_000n);
  other = await seller("po-other", 120_000n);
  cod = await seller("po-cod", 250_000n, true);
  const p = await business("po-pro", "service_provider", false);
  const serviceCat = (await owner.category.findFirstOrThrow({ where: { kind: "service", isActive: true } })).id;
  const serviceId = await asSystem(async (tx) => {
    const svc = await tx.service.create({
      data: { businessId: p.businessId, categoryId: serviceCat, title: `Braids ${tag}`, slug: `po-braids-${tag}`, basePriceKobo: 800_000n, durationMinutes: 60, locationMode: "at_provider", requiresConfirmation: false, status: "active" },
    });
    await tx.serviceAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ serviceId: svc.id, businessId: p.businessId, weekday, startMinute: 8 * 60, endMinute: 20 * 60, slotMinutes: 60, maxPerSlot: 3 })) });
    return svc.id;
  });
  provider = { ...p, serviceId };
  const u = await createUser("po-buyer");
  const x = await createUser("po-stranger");
  users.push(u.id, x.id);
  buyer = { id: u.id, email: u.email };
  stranger = { id: x.id };
}, 120_000);

afterAll(async () => {
  const businessIds = [...sellers.map((s) => s.businessId), provider.businessId];
  const orderIds = (await owner.sellerOrder.findMany({ where: { businessId: { in: businessIds } }, select: { orderId: true } })).map((o) => o.orderId);
  await asSystem(async (tx) => {
    await deleteMoneyTrail(tx, { businessIds, orderIds });
    await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    await tx.cart.deleteMany({ where: { id: { in: carts } } });
    await tx.product.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.service.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.business.deleteMany({ where: { id: { in: businessIds } } });
  });
  await deleteUsers(...users);
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("cancelling a paid order", () => {
  it("refunds everything, puts the stock back and empties the seller's escrow", async () => {
    const before = await stock(shop);
    const { placed, sos } = await paid([{ variantId: shop.variantId, businessId: shop.businessId, qty: 2 }]);
    const so = sos[0]!;
    expect(await stock(shop)).toBe(before - 2);
    expect((await balances(shop.businessId)).escrowKobo).toBeGreaterThanOrEqual(so.sellerNetKobo);
    const escrowBefore = (await balances(shop.businessId)).escrowKobo;

    const r = await sys((tx) => cancelPaidSellerOrder(tx, { sellerOrderId: so.id, businessId: shop.businessId, by: "seller", actorUserId: shop.userId, reason: "Out of stock at the warehouse" }));
    expect(r.status).toBe("approved");
    expect(r.amountKobo).toBe(paidOnline(so));
    // The whole order is refunded, so TownMart's fee comes back too.
    expect(r.amountKobo + r.feeKobo + r.vatKobo).toBe(placed.totalKobo);
    expect(r.commissionReturnedKobo).toBe(so.commissionKobo);
    expect(r.sellerDebitKobo).toBe(so.sellerNetKobo);
    expect(await stock(shop)).toBe(before);
    expect((await balances(shop.businessId)).escrowKobo).toBe(escrowBefore - so.sellerNetKobo);
    expect((await owner.sellerOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("cancelled");

    // Customers can cancel only before the seller starts; it's gone already.
    await expect(sys((tx) => cancelPaidSellerOrder(tx, { sellerOrderId: so.id, by: "customer", actorUserId: buyer.id, reason: "x" }))).rejects.toThrow(RefundError);

    expect((await processRefunds()).completed).toBeGreaterThanOrEqual(1);
    expect((await owner.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("completed");
    expect((await owner.order.findUniqueOrThrow({ where: { id: placed.orderId } })).paymentStatus).toBe("refunded");
    // Owed, then paid: nothing left in refunds payable for this refund.
    const payable = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT coalesce(sum(e.credit_kobo - e.debit_kobo), 0)::bigint AS n FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
       WHERE a.owner_type = 'platform' AND a.type = 'refunds' AND e.reference_id = ${r.id}::uuid`;
    expect(payable[0]!.n).toBe(0n);
    await expectLedgerBalanced();
  });
});

describe("returns after delivery", () => {
  it("refunds part of an order in proportion, releases the rest once, and takes later refunds from the available balance", async () => {
    const { sos } = await paid([{ variantId: shop.variantId, businessId: shop.businessId, qty: 3 }]);
    const so = sos[0]!;
    const item = so.items[0]!;
    await deliver(shop, so.id);
    const start = await balances(shop.businessId);

    const req = await sys((tx) =>
      createRefundRequest(tx, { sellerOrderId: so.id, origin: "customer", requestedBy: buyer.id, reason: "damaged", items: [{ orderItemId: item.id, qty: 1 }], includeDelivery: false, respondBy: new Date(Date.now() + 48 * 3_600_000) }),
    );
    expect(req.requestedKobo).toBe(item.lineTotalKobo / 3n);
    // A second request has to wait for the first to be answered.
    await expect(
      sys((tx) => createRefundRequest(tx, { sellerOrderId: so.id, origin: "customer", requestedBy: buyer.id, reason: "damaged", items: [{ orderItemId: item.id, qty: 1 }], includeDelivery: false, respondBy: null })),
    ).rejects.toThrow(/already a refund request/);

    // Escrow is held while the request is open, even after the release date.
    const later = new Date(Date.now() + 4 * 86_400_000);
    expect(await sys((tx) => releaseSellerOrder(tx, so.id, later))).toBeNull();

    const before = await stock(shop);
    const approved = await sys((tx) => approveRefund(tx, { refundId: req.id, businessId: shop.businessId, decidedBy: shop.userId, restockItemIds: [item.id] }));
    expect(approved.debitedFrom).toBe("escrow");
    expect(approved.feeKobo).toBe(0n);
    expect(approved.sellerDebitKobo).toBe(approved.amountKobo + approved.platformDiscountReturnedKobo - approved.commissionReturnedKobo);
    expect(await stock(shop)).toBe(before + 1);
    expect((await owner.sellerOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("delivered");

    const held = await sys(async (tx) => escrowHeld(tx, await tx.sellerOrder.findUniqueOrThrow({ where: { id: so.id } })));
    expect(held).toBe(so.sellerNetKobo - approved.sellerDebitKobo);
    expect(await sys((tx) => releaseSellerOrder(tx, so.id, later))).toBe(held);
    // Released once only.
    expect(await sys((tx) => releaseSellerOrder(tx, so.id, later))).toBeNull();
    const after = await balances(shop.businessId);
    expect(after.availableKobo - start.availableKobo).toBe(held);
    expect(start.escrowKobo - after.escrowKobo).toBe(so.sellerNetKobo);

    // A refund after release comes out of the available balance; refunding the rest returns all commission.
    const rest = await sys((tx) => createRefundRequest(tx, { sellerOrderId: so.id, origin: "customer", requestedBy: buyer.id, reason: "not_as_described", includeDelivery: true, respondBy: null }));
    const second = await sys((tx) => approveRefund(tx, { refundId: rest.id, decidedBy: shop.userId }));
    expect(second.debitedFrom).toBe("available");
    expect(approved.commissionReturnedKobo + second.commissionReturnedKobo).toBe(so.commissionKobo);
    expect(approved.sellerDebitKobo + second.sellerDebitKobo).toBe(so.sellerNetKobo);
    expect((await owner.sellerOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("refunded");
    expect((await balances(shop.businessId)).availableKobo).toBe(start.availableKobo);
    await expectLedgerBalanced();
  });

  it("lets a seller decline, and TownMart decide a dispute with a final part refund", async () => {
    const { placed, sos } = await paid([{ variantId: other.variantId, businessId: other.businessId, qty: 2 }]);
    const so = sos[0]!;
    await deliver(other, so.id);
    const req = await sys((tx) => createRefundRequest(tx, { sellerOrderId: so.id, origin: "customer", requestedBy: buyer.id, reason: "not_as_described", includeDelivery: false, respondBy: new Date(Date.now() - 1000) }));
    // Not answered in time: TownMart takes it.
    const { escalated } = await escalateOverdueRefunds();
    const dispute = await owner.dispute.findFirstOrThrow({ where: { refundId: req.id } });
    expect(escalated).toContain(dispute.id);
    expect(dispute.openedByParty).toBe("system");
    expect(await sys((tx) => releaseSellerOrder(tx, so.id, new Date(Date.now() + 5 * 86_400_000)))).toBeNull();

    // The seller declines meanwhile; TownMart decides a part refund anyway.
    await sys((tx) => rejectRefund(tx, { refundId: req.id, businessId: other.businessId, decidedBy: other.userId, response: "It was as described" }));
    const admin = (await createUser("po-admin")).id;
    users.push(admin);
    const { refundId } = await sys((tx) => resolveDispute(tx, { disputeId: dispute.id, adminId: admin, outcome: "refund_partial", amountKobo: 50_000n, note: "Half the colour was off" }));
    const r = await owner.refund.findUniqueOrThrow({ where: { id: refundId! } });
    expect(r).toMatchObject({ status: "approved", amountKobo: 50_000n, origin: "admin" });
    expect((await owner.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe("resolved");
    expect(await owner.disputeMessage.count({ where: { disputeId: dispute.id } })).toBe(2);
    expect(r.orderId).toBe(placed.orderId);
    // The decision is final.
    await expect(sys((tx) => openDispute(tx, { sellerOrderId: so.id, orderId: placed.orderId, openedBy: buyer.id, party: "customer", reason: "Asking again" }))).rejects.toThrow(/already decided/);
    expect(await sys((tx) => releaseSellerOrder(tx, so.id, new Date(Date.now() + 5 * 86_400_000)))).toBe(so.sellerNetKobo - r.sellerDebitKobo);
    await expectLedgerBalanced();
  });
});

describe("booking cancellations", () => {
  it("refunds in full when the provider cancels, and the late-cancellation share when the customer cancels late", async () => {
    const first = await paid([{ serviceId: provider.serviceId, businessId: provider.businessId, startsAt: tomorrowAt(11) }]);
    const b1 = await owner.booking.findFirstOrThrow({ where: { orderId: first.placed.orderId } });
    const c1 = await sys((tx) => cancelBooking(tx, { bookingId: b1.id, by: "seller", businessId: provider.businessId, actorUserId: provider.userId, reason: "Ill" }));
    expect(c1.refund?.amountKobo).toBe(paidOnline(first.sos[0]!));

    const second = await paid([{ serviceId: provider.serviceId, businessId: provider.businessId, startsAt: tomorrowAt(12) }]);
    const b2 = await owner.booking.findFirstOrThrow({ where: { orderId: second.placed.orderId } });
    // Two hours before the start: half back under the default policy.
    const c2 = await sys((tx) => cancelBooking(tx, { bookingId: b2.id, by: "customer", orderId: second.placed.orderId, actorUserId: buyer.id, reason: "Running late", now: new Date(b2.startsAt.getTime() - 2 * 3_600_000) }));
    expect(c2.refund?.amountKobo).toBe(paidOnline(second.sos[0]!) / 2n);
    // The order is settled as cancelled and its kept half released after the usual period.
    const so2 = await owner.sellerOrder.findUniqueOrThrow({ where: { id: second.sos[0]!.id } });
    expect(so2.status).toBe("cancelled");
    expect(so2.escrowReleaseAt).not.toBeNull();
    const released = await sys((tx) => releaseSellerOrder(tx, so2.id, new Date(Date.now() + 5 * 86_400_000)));
    expect(released).toBe(so2.sellerNetKobo - c2.refund!.sellerDebitKobo);
    await expectLedgerBalanced();
  });
});

describe("pay on delivery", () => {
  it("takes TownMart's commission and service fee from the seller's balance once the cash is collected", async () => {
    const placed = await place([{ variantId: cod.variantId, businessId: cod.businessId, qty: 1 }], "pay_on_delivery");
    const so = await owner.sellerOrder.findFirstOrThrow({ where: { orderId: placed.orderId } });
    const order = await owner.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    for (const to of ["shipped", "delivered"] as const) {
      await asSeller(cod, (tx) => advanceSellerOrder(tx, { sellerOrderId: so.id, businessId: cod.businessId, to, actorUserId: cod.userId, escrowReleaseDays: 3 }));
    }
    const later = new Date(Date.now() + 4 * 86_400_000);
    // Not settled until the seller says they have the cash.
    expect(await sys((tx) => releaseSellerOrder(tx, so.id, later))).toBeNull();
    await asSeller(cod, (tx) => markCashCollected(tx, { sellerOrderId: so.id, businessId: cod.businessId }));
    const owed = so.commissionKobo + order.serviceFeeKobo + order.vatKobo - so.platformDiscountKobo;
    expect(await sys((tx) => releaseSellerOrder(tx, so.id, later))).toBe(-owed);
    expect((await balances(cod.businessId)).availableKobo).toBe(-owed);
    // Nothing to pay out while the seller owes TownMart.
    expect(await sys((tx) => createPayout(tx, { businessId: cod.businessId, requestedBy: cod.userId, minimumKobo: 1n }))).toBe("too_small");
    await expectLedgerBalanced();
  });
});

describe("payouts", () => {
  it("pays the available balance once, and puts a failed transfer back", async () => {
    const { sos } = await paid([{ variantId: other.variantId, businessId: other.businessId, qty: 1 }]);
    await deliver(other, sos[0]!.id);
    await sys((tx) => releaseSellerOrder(tx, sos[0]!.id, new Date(Date.now() + 4 * 86_400_000)));
    const available = (await balances(other.businessId)).availableKobo;
    expect(available).toBeGreaterThan(0n);

    FakeTransfers.failNext = true;
    const failing = await sys((tx) => createPayout(tx, { businessId: other.businessId, requestedBy: other.userId, minimumKobo: 1n }));
    if (typeof failing === "string") throw new Error(failing);
    expect(failing.amountKobo).toBe(available);
    expect((await balances(other.businessId)).availableKobo).toBe(0n);
    // One payout on its way at a time.
    expect(await sys((tx) => createPayout(tx, { businessId: other.businessId, requestedBy: other.userId, minimumKobo: 1n }))).toBe("in_flight");
    expect(await sendPayout(failing.id)).toBe("failed");
    expect((await balances(other.businessId)).availableKobo).toBe(available);

    const ok = await sys((tx) => createPayout(tx, { businessId: other.businessId, requestedBy: null, minimumKobo: 1n }));
    if (typeof ok === "string") throw new Error(ok);
    expect(await sendPayout(ok.id)).toBe("paid");
    expect(await sendPayout(ok.id)).toBe("paid");
    expect((await owner.payout.findUniqueOrThrow({ where: { id: ok.id } })).providerTransferCode).toMatch(/^TRF_test_/);
    expect((await balances(other.businessId)).availableKobo).toBe(0n);
    expect(await sys((tx) => createPayout(tx, { businessId: other.businessId, requestedBy: null, minimumKobo: 1n }))).toBe("too_small");

    // The month's statement adds up to the balances.
    const s = await sys((tx) => buildStatement(tx, other.businessId, lagosMonth(new Date())));
    expect(s!.closing.availableKobo).toBe(0n);
    expect(s!.lines.some((l) => l.kind === "payout_returned")).toBe(true);
    expect(statementCsv(s!, "Other")).toContain("Payout to your bank");
    await expectLedgerBalanced();
  });
});

describe("payments that can't be used", () => {
  it("refunds a second payment for a paid order once, and reverses it when the provider pays it back", async () => {
    const { placed, payment } = await paid([{ variantId: other.variantId, businessId: other.businessId, qty: 1 }]);
    const dup = await owner.payment.create({ data: { orderId: placed.orderId, provider: "fake", providerReference: `ref-${randomUUID()}`, amountKobo: placed.totalKobo } });
    expect(await applyVerifiedPayment(dup.providerReference, verified(dup.providerReference, placed.totalKobo))).toBe("needs_attention");
    const refunds = await owner.refund.findMany({ where: { paymentId: dup.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ reason: "payment_problem", status: "approved", amountKobo: placed.totalKobo, sellerOrderId: null });
    // The original payment isn't touched.
    expect(await owner.refund.count({ where: { paymentId: payment.id } })).toBe(0);
    await processRefunds();
    expect((await owner.payment.findUniqueOrThrow({ where: { id: dup.id } })).status).toBe("reversed");
    expect((await owner.order.findUniqueOrThrow({ where: { id: placed.orderId } })).paymentStatus).toBe("paid");
    await expectLedgerBalanced();
  });

  it("marks a refund failed when the provider declines it, and lets it be retried", async () => {
    const { sos } = await paid([{ variantId: other.variantId, businessId: other.businessId, qty: 1 }]);
    const r = await sys((tx) => cancelPaidSellerOrder(tx, { sellerOrderId: sos[0]!.id, by: "customer", actorUserId: buyer.id, reason: "Ordered by mistake" }));
    FakePaymentProvider.failNextRefund = true;
    await processRefunds();
    expect((await owner.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("failed");
    // Owed is still owed: the ledger isn't touched by a failure.
    expect(await owner.ledgerTransaction.count({ where: { referenceId: r.id, kind: "refund_paid" } })).toBe(0);
    const { sendRefund } = await import("@/lib/refunds/core");
    expect(await sendRefund(r.id)).toBe("completed");
    expect(await owner.ledgerTransaction.count({ where: { referenceId: r.id, kind: "refund_paid" } })).toBe(1);
  });
});

describe("row-level security", () => {
  it("shows refunds, disputes and payouts only to their seller, their customer and TownMart", async () => {
    const { placed, sos } = await paid([{ variantId: shop.variantId, businessId: shop.businessId, qty: 1 }]);
    await deliver(shop, sos[0]!.id);
    const req = await sys((tx) => createRefundRequest(tx, { sellerOrderId: sos[0]!.id, origin: "customer", requestedBy: buyer.id, reason: "wrong_item", includeDelivery: false, respondBy: null }));
    const d = await sys((tx) => openDispute(tx, { sellerOrderId: sos[0]!.id, orderId: placed.orderId, openedBy: buyer.id, party: "customer", reason: "Wrong colour" }));

    const mine = await asSeller(shop, (tx) => tx.refund.findMany({ where: { id: req.id } }));
    const theirs = await asSeller(other, (tx) => tx.refund.findMany({ where: { id: req.id } }));
    const customer = await withRls({ userId: buyer.id }, (tx) => tx.refund.findMany({ where: { id: req.id }, include: { items: true } }));
    const nobody = await withRls({ userId: stranger.id }, (tx) => tx.refund.findMany({ where: { id: req.id } }));
    expect([mine.length, theirs.length, customer.length, nobody.length]).toEqual([1, 0, 1, 0]);
    expect(customer[0]!.items).toHaveLength(1);
    expect(await asSeller(other, (tx) => tx.dispute.count({ where: { id: d.id } }))).toBe(0);
    expect(await withRls({ userId: stranger.id }, (tx) => tx.disputeMessage.count({ where: { disputeId: d.id } }))).toBe(0);
    expect(await asSeller(other, (tx) => tx.payout.count({ where: { businessId: shop.businessId } }))).toBe(0);
    expect(await asSeller(other, (tx) => tx.ledgerEntry.count({ where: { businessId: shop.businessId } }))).toBe(0);
  });

  it("loads the seller's refunds, disputes, payouts and statement pages under its own RLS", async () => {
    const req = await owner.refund.findFirstOrThrow({ where: { businessId: shop.businessId, status: "requested" } });
    const waiting = await asSeller(shop, (tx) => listSellerRefunds(tx, shop.businessId, "waiting"));
    expect(waiting.refunds.map((r) => r.id)).toContain(req.id);
    expect(waiting.refunds.every((r) => r.orderNumber && r.customer)).toBe(true);
    const disputes = await asSeller(shop, (tx) => listSellerRefunds(tx, shop.businessId, "disputes"));
    expect(disputes.disputes.length).toBeGreaterThan(0);
    const detail = await asSeller(shop, (tx) => loadSellerRefund(tx, shop.businessId, req.id));
    expect(detail?.items).toHaveLength(1);
    expect(detail?.dispute?.status).toBe("open");
    expect(await asSeller(other, (tx) => loadSellerRefund(tx, other.businessId, req.id))).toBeNull();
    expect((await asSeller(other, (tx) => listSellerRefunds(tx, other.businessId, "all"))).refunds.some((r) => r.id === req.id)).toBe(false);
    const money = await asSeller(shop, (tx) => loadSellerPayouts(tx, shop.businessId));
    expect(money.months.length).toBeGreaterThan(0);
    expect(await asSeller(shop, (tx) => buildStatement(tx, shop.businessId, money.months[0]!.value))).not.toBeNull();
  });

  it("lets only the system scope write refunds, release escrow or create payouts", async () => {
    const so = await owner.sellerOrder.findFirstOrThrow({ where: { businessId: shop.businessId } });
    const payment = await owner.payment.findFirstOrThrow({ where: { orderId: so.orderId } });
    await expect(
      asSeller(shop, (tx) => tx.refund.create({ data: { refundNumber: `RF-X-${tag}`, orderId: so.orderId, sellerOrderId: so.id, businessId: shop.businessId, paymentId: payment.id, origin: "seller", reason: "other", requestedKobo: 1n, amountKobo: 1n } })),
    ).rejects.toThrow(/row-level security/);
    await expect(asSeller(shop, (tx) => tx.sellerOrder.update({ where: { id: so.id }, data: { escrowReleasedAt: new Date() } }))).rejects.toThrow(/Only TownMart can release escrow/);
    await expect(
      asSeller(shop, (tx) => tx.payout.create({ data: { businessId: shop.businessId, amountKobo: 1n, provider: "fake", reference: `PO-X-${tag}`, bankName: "x", accountNumberLast4: "0000", accountName: "x", periodStart: new Date(), periodEnd: new Date() } })),
    ).rejects.toThrow(/row-level security/);
    // A customer can't approve their own refund.
    const req = await owner.refund.findFirstOrThrow({ where: { businessId: shop.businessId, status: "requested" } });
    await withRls({ userId: buyer.id }, (tx) => tx.refund.updateMany({ where: { id: req.id }, data: { status: "approved" } }));
    expect((await owner.refund.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("requested");
  });

  it("lets each side add to its own open dispute only", async () => {
    const d = await owner.dispute.findFirstOrThrow({ where: { businessId: shop.businessId, status: "open" } });
    await asSeller(shop, (tx) => tx.disputeMessage.create({ data: { disputeId: d.id, businessId: shop.businessId, sender: "seller", senderUserId: shop.userId, body: "We sent the right one" } }));
    await withRls({ userId: buyer.id }, (tx) => tx.disputeMessage.create({ data: { disputeId: d.id, businessId: shop.businessId, sender: "customer", senderUserId: buyer.id, body: "Photo attached" } }));
    await expect(asSeller(other, (tx) => tx.disputeMessage.create({ data: { disputeId: d.id, businessId: shop.businessId, sender: "seller", senderUserId: other.userId, body: "x" } }))).rejects.toThrow(/row-level security/);
    await expect(withRls({ userId: stranger.id }, (tx) => tx.disputeMessage.create({ data: { disputeId: d.id, businessId: shop.businessId, sender: "customer", senderUserId: stranger.id, body: "x" } }))).rejects.toThrow(/row-level security/);
    // Posing as TownMart doesn't work either.
    await expect(asSeller(shop, (tx) => tx.disputeMessage.create({ data: { disputeId: d.id, businessId: shop.businessId, sender: "admin", senderUserId: shop.userId, body: "Resolved" } }))).rejects.toThrow(/row-level security/);
    await expect(owner.disputeMessage.updateMany({ where: { disputeId: d.id }, data: { body: "edited" } })).rejects.toThrow(/append-only/);
  });
});
