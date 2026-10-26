import { createHmac, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as webhook } from "@/app/api/webhooks/[provider]/route";
import { prisma, withRls, withSystemContext } from "@/lib/db";
import { computeCheckout } from "@/lib/checkout/compute";
import { applyVerifiedPayment, expireUnpaidOrders, processPaymentEvent } from "@/lib/orders/payment";
import { OrderError, placeOrder, type PlacedOrder } from "@/lib/orders/place";
import { FakePaymentProvider } from "@/lib/payments/fake";
import type { VerifiedPayment } from "@/lib/payments";
import { redis } from "@/lib/redis";
import { createUser, deleteUsers, lagosIkeja, owner } from "./helpers";

/**
 * Checkout end to end at the database layer: placing orders across sellers,
 * no overselling under concurrency, payment confirmation and webhook replays
 * applied once, a balanced append-only ledger, expiry releasing stock, and
 * each seller seeing only its own part of an order.
 */

type Seller = { userId: string; businessId: string; productId: string; variantId: string };

const tag = randomUUID().slice(0, 8);
let categoryId: string;
let a: Seller;
let b: Seller;
let buyer: { id: string; email: string };
let stranger: { id: string };
const carts: string[] = [];
const sellers: Seller[] = [];
const users: string[] = [];

function asSystem<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
    return fn(tx);
  });
}

async function createSeller(label: string, opts: { priceKobo: bigint; stock: number; payOnDelivery: boolean }): Promise<Seller> {
  const user = await createUser(label);
  users.push(user.id);
  const { stateId, lgaId } = await lagosIkeja();
  return asSystem(async (tx) => {
    const business = await tx.business.create({
      data: {
        ownerUserId: user.id,
        type: "merchant",
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
        policy: { create: { acceptsPayOnDelivery: opts.payOnDelivery, deliveryOptions: { delivery: true, pickup: true } } },
      },
    });
    const product = await tx.product.create({
      data: { businessId: business.id, categoryId, title: `${label} item ${tag}`, slug: `${label}-item-${tag}`, basePriceKobo: opts.priceKobo, status: "active" },
    });
    const variant = await tx.productVariant.create({
      data: { productId: product.id, businessId: business.id, sku: `${label}-${tag}`, priceKobo: opts.priceKobo, stockQty: opts.stock, isDefault: true },
    });
    const seller = { userId: user.id, businessId: business.id, productId: product.id, variantId: variant.id };
    sellers.push(seller);
    return seller;
  });
}

async function cartWith(items: { seller: Seller; qty: number }[], userId: string | null = null): Promise<string> {
  const cart = await owner.cart.create({
    data: {
      userId,
      guestTokenHash: userId ? null : `test-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
      items: { create: items.map((i) => ({ variantId: i.seller.variantId, businessId: i.seller.businessId, qty: i.qty })) },
    },
  });
  carts.push(cart.id);
  return cart.id;
}

async function address() {
  const { stateId, lgaId } = await lagosIkeja();
  return { recipientName: "Ada Obi", phone: "08031234567", line1: "12 Allen Avenue", line2: "", landmark: "", city: "Ikeja", stateId, lgaId };
}

/** Prices the cart as the checkout page would, then places the order with that total. */
async function order(cartId: string, opts: { userId?: string | null; payment?: "online" | "pay_on_delivery" } = {}): Promise<PlacedOrder> {
  const addr = await address();
  const userId = opts.userId ?? null;
  const quote = await withSystemContext((tx) => computeCheckout(tx, { cartId, userId, address: { stateId: addr.stateId, lgaId: addr.lgaId } }));
  return withSystemContext(
    (tx) =>
      placeOrder(tx, {
        cartId,
        userId,
        accountEmail: userId ? buyer.email : null,
        accountName: null,
        ipHash: "test",
        data: {
          email: userId ? "" : `guest-${randomUUID()}@test.townmart.local`,
          address: addr,
          addressId: "",
          saveAddress: false,
          methods: {},
          payment: opts.payment ?? "online",
          acceptTerms: true,
          marketingConsent: false,
          expectedTotalKobo: quote.quote.totalKobo.toString(),
        },
      }),
    { timeout: 60_000, maxWait: 60_000 },
  );
}

const stock = async (s: Seller) => (await owner.productVariant.findUniqueOrThrow({ where: { id: s.variantId } })).stockQty.toNumber();
const paymentFor = (orderId: string) => owner.payment.create({ data: { orderId, provider: "fake", providerReference: `ref-${randomUUID()}`, amountKobo: 1n } });
const verified = (reference: string, amountKobo: bigint, status: VerifiedPayment["status"] = "success"): VerifiedPayment => ({
  reference,
  status,
  amountKobo,
  currency: "NGN",
  channel: "card",
  paidAt: new Date(),
  raw: {},
});

async function setPaymentAmount(id: string, amountKobo: bigint) {
  await owner.payment.update({ where: { id }, data: { amountKobo } });
}

beforeAll(async () => {
  categoryId = (await owner.category.findFirstOrThrow({ where: { kind: "product", isActive: true, parentId: { not: null } } })).id;
  a = await createSeller("co-a", { priceKobo: 200_000n, stock: 10, payOnDelivery: true });
  b = await createSeller("co-b", { priceKobo: 500_000n, stock: 20, payOnDelivery: false });
  const u = await createUser("co-buyer");
  const s = await createUser("co-stranger");
  users.push(u.id, s.id);
  buyer = { id: u.id, email: u.email };
  stranger = { id: s.id };
});

afterAll(async () => {
  const businessIds = sellers.map((s) => s.businessId);
  const orderIds = (await owner.sellerOrder.findMany({ where: { businessId: { in: businessIds } }, select: { orderId: true } })).map((o) => o.orderId);
  await asSystem(async (tx) => {
    const txIds = (await tx.ledgerEntry.findMany({ where: { businessId: { in: businessIds } }, select: { transactionId: true } })).map((e) => e.transactionId);
    await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: txIds } } });
    await tx.ledgerTransaction.deleteMany({ where: { id: { in: txIds } } });
    await tx.ledgerAccount.deleteMany({ where: { ownerId: { in: businessIds } } });
    await tx.paymentEvent.deleteMany({ where: { payload: { path: ["tag"], equals: tag } } });
    await tx.promotionRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    await tx.cart.deleteMany({ where: { id: { in: carts } } });
    await tx.product.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.business.deleteMany({ where: { id: { in: businessIds } } });
  });
  await deleteUsers(...users);
  await owner.$disconnect();
  await prisma.$disconnect();
  redis.disconnect();
});

describe("placing an order", () => {
  it("splits one checkout across two sellers, holds the stock and empties the cart", async () => {
    const [stockA, stockB] = [await stock(a), await stock(b)];
    const placed = await order(await cartWith([{ seller: a, qty: 2 }, { seller: b, qty: 1 }]), { userId: buyer.id });

    const o = await owner.order.findUniqueOrThrow({ where: { id: placed.orderId }, include: { sellerOrders: true, reservations: true } });
    expect(o.orderNumber).toMatch(/^TM-\d{4}-\d{6}$/);
    expect(o.paymentStatus).toBe("unpaid");
    expect(o.termsVersion).toBeTruthy();
    expect(o.refundPolicyVersion).toBeTruthy();
    expect(o.sellerOrders.map((s) => s.businessId).sort()).toEqual([a.businessId, b.businessId].sort());
    expect(o.sellerOrders.every((s) => s.status === "pending_payment" && s.orderNumber === o.orderNumber)).toBe(true);
    expect(o.subtotalKobo).toBe(900_000n);
    // Service fee: 1% capped at ₦1,000; VAT at 7.5% of the fee.
    expect(o.serviceFeeKobo).toBe(9_000n);
    expect(o.vatKobo).toBe(675n);
    expect(o.totalKobo).toBe(o.subtotalKobo - o.discountKobo + o.deliveryKobo + o.serviceFeeKobo + o.vatKobo);
    expect(o.reservations.every((r) => r.status === "held")).toBe(true);
    expect([await stock(a), await stock(b)]).toEqual([stockA - 2, stockB - 1]);
    expect(await owner.cartItem.count({ where: { cart: { userId: buyer.id } } })).toBe(0);
  });

  it("refuses an order whose total changed since the shopper saw it", async () => {
    const cartId = await cartWith([{ seller: b, qty: 1 }]);
    const addr = await address();
    await expect(
      withSystemContext((tx) =>
        placeOrder(tx, {
          cartId,
          userId: null,
          accountEmail: null,
          accountName: null,
          ipHash: "test",
          data: { email: "x@test.townmart.local", address: addr, addressId: "", saveAddress: false, methods: {}, payment: "online", acceptTerms: true, marketingConsent: false, expectedTotalKobo: "1" },
        }),
      ),
    ).rejects.toMatchObject({ code: "price_changed" });
  });

  it("only offers pay on delivery when every seller in the order accepts it", async () => {
    await expect(order(await cartWith([{ seller: a, qty: 1 }, { seller: b, qty: 1 }]), { payment: "pay_on_delivery" })).rejects.toThrow(OrderError);
    const placed = await order(await cartWith([{ seller: a, qty: 1 }]), { payment: "pay_on_delivery" });
    const o = await owner.order.findUniqueOrThrow({ where: { id: placed.orderId }, include: { sellerOrders: true } });
    expect(o.paymentStatus).toBe("pay_on_delivery");
    expect(o.sellerOrders[0]).toMatchObject({ status: "processing", payOnDelivery: true });
  });
});

describe("overselling", () => {
  it("sells exactly the stock there is when 50 buyers race for 10 units", async () => {
    const racer = await createSeller("co-race", { priceKobo: 100_000n, stock: 10, payOnDelivery: false });
    const cartIds = await Promise.all(Array.from({ length: 50 }, () => cartWith([{ seller: racer, qty: 1 }])));
    const results = await Promise.allSettled(cartIds.map((id) => order(id)));
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(refused).toHaveLength(40);
    // Refused either at the stock lock or, once it's gone, when the cart is re-checked.
    for (const r of refused) expect(r.reason).toMatchObject({ code: "out_of_stock" });
    expect(await stock(racer)).toBe(0);
    expect(await owner.orderItem.count({ where: { variantId: racer.variantId } })).toBe(10);
  });
});

describe("payment confirmation", () => {
  it("marks the order paid once, converts the hold and posts one balanced ledger transaction", async () => {
    const placed = await order(await cartWith([{ seller: a, qty: 1 }, { seller: b, qty: 1 }]), { userId: buyer.id });
    const p = await paymentFor(placed.orderId);
    await setPaymentAmount(p.id, placed.totalKobo);

    expect(await applyVerifiedPayment(p.providerReference, verified(p.providerReference, placed.totalKobo))).toBe("paid");
    expect(await applyVerifiedPayment(p.providerReference, verified(p.providerReference, placed.totalKobo))).toBe("already_paid");

    const o = await owner.order.findUniqueOrThrow({ where: { id: placed.orderId }, include: { sellerOrders: true, reservations: true } });
    expect(o.paymentStatus).toBe("paid");
    expect(o.sellerOrders.every((s) => s.status === "paid")).toBe(true);
    expect(o.reservations.every((r) => r.status === "converted")).toBe(true);

    const txs = await owner.ledgerTransaction.findMany({ where: { referenceId: placed.orderId }, include: { entries: { include: { account: true } } } });
    expect(txs).toHaveLength(1);
    const entries = txs[0]!.entries;
    const debits = entries.reduce((n, e) => n + e.debitKobo, 0n);
    const credits = entries.reduce((n, e) => n + e.creditKobo, 0n);
    expect(debits).toBe(credits);
    expect(debits).toBeGreaterThanOrEqual(placed.totalKobo);
    // Each seller's escrow holds exactly its net.
    for (const so of o.sellerOrders) {
      const escrow = entries.filter((e) => e.account.type === "escrow" && e.account.ownerId === so.businessId);
      expect(escrow.reduce((n, e) => n + e.creditKobo - e.debitKobo, 0n)).toBe(so.sellerNetKobo);
    }
  });

  it("doesn't accept a payment for the wrong amount", async () => {
    const placed = await order(await cartWith([{ seller: b, qty: 1 }]));
    const p = await paymentFor(placed.orderId);
    await setPaymentAmount(p.id, placed.totalKobo);
    expect(await applyVerifiedPayment(p.providerReference, verified(p.providerReference, placed.totalKobo - 100n))).toBe("needs_attention");
    expect((await owner.order.findUniqueOrThrow({ where: { id: placed.orderId } })).paymentStatus).toBe("unpaid");
    expect(await owner.ledgerTransaction.count({ where: { referenceId: placed.orderId } })).toBe(0);
  });
});

describe("webhooks", () => {
  const sign = (body: string) => createHmac("sha256", process.env.AUTH_SECRET!).update(body).digest("hex");
  const deliver = (body: string, signature = sign(body)) =>
    webhook(new Request("http://localhost/api/webhooks/fake", { method: "POST", body, headers: { "x-fake-signature": signature } }), { params: Promise.resolve({ provider: "fake" }) });

  it("stores a replayed event once and applies the payment once", async () => {
    const placed = await order(await cartWith([{ seller: b, qty: 1 }]));
    const p = await paymentFor(placed.orderId);
    await setPaymentAmount(p.id, placed.totalKobo);
    await new FakePaymentProvider().start({ reference: p.providerReference, amountKobo: placed.totalKobo, email: "x@test.townmart.local", name: "x", callbackUrl: "http://localhost", description: "test" });
    await FakePaymentProvider.settle(p.providerReference, "success");

    const body = JSON.stringify({ id: `evt-${randomUUID()}`, event: "charge.success", reference: p.providerReference, tag });
    const first = await deliver(body);
    const second = await deliver(body);
    expect(first.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });

    const events = await owner.paymentEvent.findMany({ where: { reference: p.providerReference } });
    expect(events).toHaveLength(1);
    await processPaymentEvent(events[0]!.id);
    await processPaymentEvent(events[0]!.id);
    expect((await owner.order.findUniqueOrThrow({ where: { id: placed.orderId } })).paymentStatus).toBe("paid");
    expect(await owner.ledgerTransaction.count({ where: { referenceId: placed.orderId } })).toBe(1);
  });

  it("rejects a bad signature and never acts on it", async () => {
    const body = JSON.stringify({ id: `evt-${randomUUID()}`, event: "charge.success", reference: "nope", tag });
    const res = await deliver(body, "forged");
    expect(res.status).toBe(401);
    const stored = await owner.paymentEvent.findFirstOrThrow({ where: { reference: "nope", payload: { path: ["tag"], equals: tag } } });
    expect(stored.signatureValid).toBe(false);
  });
});

describe("expiry", () => {
  it("cancels unpaid orders after the hold and puts the stock back", async () => {
    const seller = await createSeller("co-exp", { priceKobo: 100_000n, stock: 8, payOnDelivery: false });
    const placed = await order(await cartWith([{ seller, qty: 3 }]));
    expect(await stock(seller)).toBe(5);
    const due = (await owner.order.findUniqueOrThrow({ where: { id: placed.orderId } })).paymentDueAt!;

    await expireUnpaidOrders(new Date(due.getTime() + 1000));
    const o = await owner.order.findUniqueOrThrow({ where: { id: placed.orderId }, include: { reservations: true, sellerOrders: true } });
    expect(o.cancelledAt).not.toBeNull();
    expect(o.reservations.every((r) => r.status === "released")).toBe(true);
    expect(o.sellerOrders[0]!.status).toBe("cancelled");
    expect(await stock(seller)).toBe(8);
  });
});

describe("ledger rules", () => {
  it("rejects an unbalanced transaction", async () => {
    await expect(
      asSystem(async (tx) => {
        const account = await tx.ledgerAccount.create({ data: { ownerType: "business", ownerId: a.businessId, ownerKey: a.businessId, type: "available" } });
        const ref = { referenceType: "test", referenceId: randomUUID() };
        const t = await tx.ledgerTransaction.create({ data: { kind: "test", ...ref, memo: "unbalanced" } });
        await tx.ledgerEntry.create({ data: { transactionId: t.id, accountId: account.id, businessId: a.businessId, debitKobo: 100n, creditKobo: 0n, ...ref } });
      }),
    ).rejects.toThrow(/balance/i);
  });

  it("never lets the app change or delete ledger entries", async () => {
    const entry = await owner.ledgerEntry.findFirstOrThrow({ where: { businessId: a.businessId } });
    await expect(withSystemContext((tx) => tx.ledgerEntry.update({ where: { id: entry.id }, data: { debitKobo: 1n } }))).rejects.toThrow();
    await expect(withSystemContext((tx) => tx.ledgerEntry.delete({ where: { id: entry.id } }))).rejects.toThrow();
  });
});

describe("RLS: orders and money", () => {
  const as = (s: Seller) => ({ userId: s.userId, businessId: s.businessId });

  it("shows each seller only its own part of a shared order", async () => {
    const placed = await order(await cartWith([{ seller: a, qty: 1 }, { seller: b, qty: 1 }]), { userId: buyer.id });
    const sellerOrders = await withRls(as(a), (tx) => tx.sellerOrder.findMany({ where: { orderId: placed.orderId } }));
    expect(sellerOrders.map((s) => s.businessId)).toEqual([a.businessId]);
    const items = await withRls(as(a), (tx) => tx.orderItem.findMany({ where: { sellerOrder: { orderId: placed.orderId } } }));
    expect(items.every((i) => i.businessId === a.businessId)).toBe(true);
    expect(items).toHaveLength(1);
    // The order row (customer contact, other sellers' totals) is not the seller's to read.
    expect(await withRls(as(a), (tx) => tx.order.findMany({ where: { id: placed.orderId } }))).toEqual([]);
    const reservations = await withRls(as(a), (tx) => tx.stockReservation.findMany({ where: { orderId: placed.orderId } }));
    expect(reservations.every((r) => r.businessId === a.businessId)).toBe(true);
  });

  it("shows a shopper their own orders and payments, and nobody else's", async () => {
    const mine = await withRls({ userId: buyer.id }, (tx) => tx.order.findMany({ where: { userId: buyer.id } }));
    expect(mine.length).toBeGreaterThan(0);
    const all = await withRls({ userId: buyer.id }, (tx) => tx.sellerOrder.findMany({ where: { orderId: { in: mine.map((o) => o.id) } } }));
    expect(all.length).toBeGreaterThanOrEqual(mine.length);
    expect(await withRls({ userId: stranger.id }, (tx) => tx.order.findMany({ where: { userId: buyer.id } }))).toEqual([]);
    expect(await withRls({ userId: stranger.id }, (tx) => tx.payment.findMany({ where: { order: { userId: buyer.id } } }))).toEqual([]);
    expect(await withRls({ userId: null }, (tx) => tx.order.findMany({ where: { userId: buyer.id } }))).toEqual([]);
  });

  it("shows a seller only its own ledger accounts and entries", async () => {
    const accounts = await withRls(as(a), (tx) => tx.ledgerAccount.findMany({ where: { ownerId: { in: [a.businessId, b.businessId] } } }));
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts.every((x) => x.ownerId === a.businessId)).toBe(true);
    const entries = await withRls(as(a), (tx) => tx.ledgerEntry.findMany({ where: { businessId: { in: [a.businessId, b.businessId] } } }));
    expect(entries.every((e) => e.businessId === a.businessId)).toBe(true);
    // Transactions are visible through the seller's own entries.
    const txs = await withRls(as(a), (tx) => tx.ledgerTransaction.findMany({ where: { id: { in: entries.map((e) => e.transactionId) } } }));
    expect(txs.length).toBeGreaterThan(0);
    // Platform accounts (commission, fees, tax) are not visible to sellers.
    expect(await withRls(as(a), (tx) => tx.ledgerAccount.findMany({ where: { ownerType: "platform" } }))).toEqual([]);
  });

  it("can't write orders, payments or ledger rows as a user or seller", async () => {
    const o = await owner.order.findFirstOrThrow({ where: { userId: buyer.id } });
    const updated = await withRls({ userId: buyer.id }, (tx) => tx.order.updateMany({ where: { id: o.id }, data: { paymentStatus: "paid" } }));
    expect(updated.count).toBe(0);
    // Sellers may update their own orders' status columns only: money columns aren't granted.
    await expect(withRls(as(a), (tx) => tx.sellerOrder.updateMany({ where: { businessId: a.businessId }, data: { sellerNetKobo: 999_999_999n } }))).rejects.toThrow(/permission denied/);
    await expect(withRls(as(a), (tx) => tx.payment.create({ data: { orderId: o.id, provider: "fake", providerReference: `x-${randomUUID()}`, amountKobo: 1n } }))).rejects.toThrow();
  });

  it("keeps guest carts apart", async () => {
    const mine = await cartWith([{ seller: a, qty: 1 }]);
    const theirs = await cartWith([{ seller: b, qty: 1 }]);
    const seen = await withRls({ userId: null, cartId: mine }, (tx) => tx.cart.findMany({ where: { id: { in: [mine, theirs] } } }));
    expect(seen.map((c) => c.id)).toEqual([mine]);
    const items = await withRls({ userId: null, cartId: mine }, (tx) => tx.cartItem.findMany({ where: { cartId: theirs } }));
    expect(items).toEqual([]);
    const moved = await withRls({ userId: null, cartId: mine }, (tx) => tx.cartItem.updateMany({ where: { cartId: theirs }, data: { qty: 99 } }));
    expect(moved.count).toBe(0);
    expect(await withRls({ userId: null }, (tx) => tx.cart.findMany({ where: { id: { in: [mine, theirs] } } }))).toEqual([]);
  });
});
