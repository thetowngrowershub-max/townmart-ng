import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeCheckout } from "@/lib/checkout/compute";
import { prisma, withRls, withSystemContext } from "@/lib/db";
import { advanceSellerOrder } from "@/lib/fulfilment/orders";
import { OrderError, placeOrder, type PlacedOrder } from "@/lib/orders/place";
import { redis } from "@/lib/redis";
import { findReviewable, writeReview } from "@/lib/reviews/reviews";
import { createUser, deleteUsers, lagosIkeja, owner } from "./helpers";

/**
 * Phase 4 at the database layer: a booking slot is never oversold under
 * concurrency, the status and time guards hold for sellers, bookings,
 * messages, reviews and wishlists stay with their owners, and only verified
 * buyers can review.
 */

type Seller = { userId: string; businessId: string };

const tag = randomUUID().slice(0, 8);
let shop: Seller & { variantId: string; productId: string };
let provider: Seller & { serviceId: string };
let buyer: { id: string; email: string };
let stranger: { id: string };
const carts: string[] = [];
const users: string[] = [];

function asSystem<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
    return fn(tx);
  });
}

async function createBusiness(label: string, type: "merchant" | "service_provider"): Promise<Seller> {
  const user = await createUser(label);
  users.push(user.id);
  const { stateId, lgaId } = await lagosIkeja();
  const business = await asSystem((tx) =>
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
        policy: { create: { acceptsPayOnDelivery: true, deliveryOptions: { delivery: true, pickup: true } } },
      },
    }),
  );
  return { userId: user.id, businessId: business.id };
}

/** Tomorrow at `hour`:00, Lagos time. */
function tomorrowAt(hour: number): Date {
  const lagosToday = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  return new Date(new Date(`${lagosToday}T${String(hour).padStart(2, "0")}:00:00+01:00`).getTime() + 86_400_000);
}

async function cart(item: { variantId: string; businessId: string } | { serviceId: string; businessId: string; startsAt: Date }, userId: string | null = null) {
  // A shopper has one cart; placing an order empties it but keeps it.
  if (userId) await owner.cart.deleteMany({ where: { userId } });
  const c = await owner.cart.create({
    data: {
      userId,
      guestTokenHash: userId ? null : `test-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
      items: {
        create: [
          "variantId" in item
            ? { variantId: item.variantId, businessId: item.businessId, qty: 1 }
            : { serviceId: item.serviceId, businessId: item.businessId, bookingStartsAt: item.startsAt, atProvider: true, qty: 1 },
        ],
      },
    },
  });
  carts.push(c.id);
  return c.id;
}

async function quoteTotal(cartId: string, userId: string | null) {
  const { stateId, lgaId } = await lagosIkeja();
  const q = await withSystemContext((tx) => computeCheckout(tx, { cartId, userId, address: { stateId, lgaId } }));
  return q.quote.totalKobo.toString();
}

async function order(cartId: string, opts: { userId?: string | null; payment?: "online" | "pay_on_delivery"; expectedTotalKobo?: string } = {}): Promise<PlacedOrder> {
  const { stateId, lgaId } = await lagosIkeja();
  const userId = opts.userId ?? null;
  const expectedTotalKobo = opts.expectedTotalKobo ?? (await quoteTotal(cartId, userId));
  return withSystemContext(
    (tx) =>
      placeOrder(tx, {
        cartId,
        userId,
        accountEmail: userId ? buyer.email : null,
        accountName: userId ? "Ada Obi" : null,
        ipHash: "test",
        data: {
          email: userId ? "" : `guest-${randomUUID()}@test.townmart.local`,
          address: { recipientName: "Ada Obi", phone: "08031234567", line1: "12 Allen Avenue", line2: "", landmark: "", city: "Ikeja", stateId, lgaId },
          addressId: "",
          saveAddress: false,
          methods: {},
          payment: opts.payment ?? "online",
          acceptTerms: true,
          marketingConsent: false,
          expectedTotalKobo,
        },
      }),
    { timeout: 60_000, maxWait: 60_000 },
  );
}

const asSeller = <T>(s: Seller, fn: (tx: Prisma.TransactionClient) => Promise<T>) => withRls({ userId: s.userId, businessId: s.businessId }, fn);
const asUser = <T>(userId: string | null, fn: (tx: Prisma.TransactionClient) => Promise<T>) => withRls({ userId }, fn);

let shopOrder: PlacedOrder;
let shopSellerOrderId: string;
let bookingId: string;

beforeAll(async () => {
  const productCat = (await owner.category.findFirstOrThrow({ where: { kind: "product", isActive: true, parentId: { not: null } } })).id;
  const serviceCat = (await owner.category.findFirstOrThrow({ where: { kind: "service", isActive: true } })).id;
  const s = await createBusiness("ff-shop", "merchant");
  const p = await createBusiness("ff-pro", "service_provider");
  const product = await asSystem(async (tx) => {
    const prod = await tx.product.create({ data: { businessId: s.businessId, categoryId: productCat, title: `Soap ${tag}`, slug: `ff-soap-${tag}`, basePriceKobo: 150_000n, status: "active" } });
    const v = await tx.productVariant.create({ data: { productId: prod.id, businessId: s.businessId, sku: `ff-${tag}`, priceKobo: 150_000n, stockQty: 50, isDefault: true } });
    return { productId: prod.id, variantId: v.id };
  });
  shop = { ...s, ...product };
  const serviceId = await asSystem(async (tx) => {
    const svc = await tx.service.create({
      data: { businessId: p.businessId, categoryId: serviceCat, title: `Haircut ${tag}`, slug: `ff-cut-${tag}`, basePriceKobo: 500_000n, durationMinutes: 60, locationMode: "at_provider", requiresConfirmation: false, status: "active" },
    });
    await tx.serviceAvailability.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ serviceId: svc.id, businessId: p.businessId, weekday, startMinute: 8 * 60, endMinute: 20 * 60, slotMinutes: 60, maxPerSlot: 2 })),
    });
    return svc.id;
  });
  provider = { ...p, serviceId };
  const u = await createUser("ff-buyer");
  const x = await createUser("ff-stranger");
  users.push(u.id, x.id);
  buyer = { id: u.id, email: u.email };
  stranger = { id: x.id };

  // The buyer's own pay-on-delivery orders: soap from the shop, a haircut from the provider.
  shopOrder = await order(await cart({ variantId: shop.variantId, businessId: shop.businessId }, buyer.id), { userId: buyer.id, payment: "pay_on_delivery" });
  shopSellerOrderId = (await owner.sellerOrder.findFirstOrThrow({ where: { orderId: shopOrder.orderId } })).id;
  const cutOrder = await order(await cart({ serviceId, businessId: p.businessId, startsAt: tomorrowAt(15) }, buyer.id), { userId: buyer.id, payment: "pay_on_delivery" });
  bookingId = (await owner.booking.findFirstOrThrow({ where: { orderId: cutOrder.orderId } })).id;
}, 120_000);

afterAll(async () => {
  const businessIds = [shop.businessId, provider.businessId];
  const orderIds = (await owner.sellerOrder.findMany({ where: { businessId: { in: businessIds } }, select: { orderId: true } })).map((o) => o.orderId);
  await asSystem(async (tx) => {
    const txIds = (await tx.ledgerEntry.findMany({ where: { businessId: { in: businessIds } }, select: { transactionId: true } })).map((e) => e.transactionId);
    await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: txIds } } });
    await tx.ledgerTransaction.deleteMany({ where: { id: { in: txIds } } });
    await tx.ledgerAccount.deleteMany({ where: { ownerId: { in: businessIds } } });
    await tx.review.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    await tx.cart.deleteMany({ where: { id: { in: carts } } });
    await tx.wishlistItem.deleteMany({ where: { userId: { in: users } } });
    await tx.product.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.service.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.business.deleteMany({ where: { id: { in: businessIds } } });
  });
  await deleteUsers(...users);
  await owner.$disconnect();
  await prisma.$disconnect();
  redis.disconnect();
});

describe("booking a slot", () => {
  it("takes exactly as many bookings as the slot has places when 8 shoppers race for it", async () => {
    const startsAt = tomorrowAt(10);
    const cartIds = await Promise.all(Array.from({ length: 8 }, () => cart({ serviceId: provider.serviceId, businessId: provider.businessId, startsAt })));
    // Everyone saw the slot open and the same total before anyone paid.
    const totals = await Promise.all(cartIds.map((c) => quoteTotal(c, null)));
    const results = await Promise.allSettled(cartIds.map((c, i) => order(c, { expectedTotalKobo: totals[i] })));
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(2);
    expect(lost.every((r) => r.reason instanceof OrderError && r.reason.code === "slot_taken")).toBe(true);
    const booked = await owner.booking.findMany({ where: { serviceId: provider.serviceId, startsAt }, select: { slotNo: true, status: true } });
    expect(booked.map((b) => b.slotNo).sort()).toEqual([1, 2]);
    expect(booked.every((b) => b.status === "held")).toBe(true);
  }, 120_000);

  it("lets the database refuse a third booking in a full slot even without the app's checks", async () => {
    const startsAt = tomorrowAt(10);
    const existing = await owner.booking.findFirstOrThrow({ where: { serviceId: provider.serviceId, startsAt } });
    // A copy of a booking in the same place of the same time breaks the exclusion constraint.
    await expect(
      asSystem((tx) =>
        tx.$executeRaw`INSERT INTO bookings (order_id, seller_order_id, order_item_id, business_id, service_id, starts_at, ends_at, slot_no, capacity, status, location_snapshot, price_kobo)
          SELECT order_id, seller_order_id, ${randomUUID()}::uuid, business_id, service_id, starts_at, ends_at, slot_no, capacity, 'held', location_snapshot, price_kobo FROM bookings WHERE id = ${existing.id}::uuid`,
      ),
    ).rejects.toThrow();
  });
});

describe("status guards", () => {
  it("lets a seller take only its own forward steps on an order", async () => {
    // Pay on delivery orders start at processing.
    await expect(asSeller(shop, (tx) => tx.sellerOrder.update({ where: { id: shopSellerOrderId }, data: { status: "completed" } }))).rejects.toThrow(/can't move an order/);
    await expect(asSeller(shop, (tx) => tx.sellerOrder.update({ where: { id: shopSellerOrderId }, data: { status: "refunded" } }))).rejects.toThrow(/can't move an order/);
    await asSeller(shop, (tx) => advanceSellerOrder(tx, { sellerOrderId: shopSellerOrderId, businessId: shop.businessId, to: "shipped", actorUserId: shop.userId, tracking: { number: "GIG123", carrier: "GIG" }, escrowReleaseDays: 3 }));
    expect((await owner.sellerOrder.findUniqueOrThrow({ where: { id: shopSellerOrderId } })).status).toBe("shipped");
  });

  it("never lets another seller touch the order", async () => {
    const n = await asSeller(provider, (tx) => tx.sellerOrder.updateMany({ where: { id: shopSellerOrderId }, data: { status: "delivered" } }));
    expect(n.count).toBe(0);
    expect(await asSeller(provider, (tx) => tx.sellerOrder.findUnique({ where: { id: shopSellerOrderId } }))).toBeNull();
  });

  it("lets a provider step a booking along but not skip, undo or move it", async () => {
    const b = await owner.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b.status).toBe("confirmed");
    await expect(asSeller(provider, (tx) => tx.booking.update({ where: { id: bookingId }, data: { status: "completed" } }))).rejects.toThrow(/can't move a booking/);
    await expect(asSeller(provider, (tx) => tx.booking.update({ where: { id: bookingId }, data: { status: "cancelled" } }))).rejects.toThrow(/can't move a booking/);
    await expect(asSeller(provider, (tx) => tx.booking.update({ where: { id: bookingId }, data: { startsAt: tomorrowAt(16), endsAt: tomorrowAt(17) } }))).rejects.toThrow(/Only TownMart can move a booking/);
    await expect(asSeller(provider, (tx) => tx.booking.update({ where: { id: bookingId }, data: { priceKobo: 1n } }))).rejects.toThrow(/permission denied/);
    await asSeller(provider, (tx) => tx.booking.update({ where: { id: bookingId }, data: { status: "in_progress" } }));
    await expect(asSeller(provider, (tx) => tx.booking.update({ where: { id: bookingId }, data: { status: "confirmed" } }))).rejects.toThrow(/can't move a booking/);
  });

  it("lets TownMart code move a booking", async () => {
    const other = await owner.booking.findFirstOrThrow({ where: { serviceId: provider.serviceId, startsAt: tomorrowAt(10) } });
    await withSystemContext((tx) => tx.booking.update({ where: { id: other.id }, data: { startsAt: tomorrowAt(11), endsAt: tomorrowAt(12), previousStartsAt: other.startsAt } }));
    expect((await owner.booking.findUniqueOrThrow({ where: { id: other.id } })).startsAt).toEqual(tomorrowAt(11));
  });
});

describe("RLS: bookings and messages", () => {
  it("shows a booking to its provider and customer only", async () => {
    expect(await asSeller(provider, (tx) => tx.booking.findUnique({ where: { id: bookingId } }))).not.toBeNull();
    expect(await asUser(buyer.id, (tx) => tx.booking.findUnique({ where: { id: bookingId } }))).not.toBeNull();
    expect(await asSeller(shop, (tx) => tx.booking.findUnique({ where: { id: bookingId } }))).toBeNull();
    expect(await asUser(stranger.id, (tx) => tx.booking.findUnique({ where: { id: bookingId } }))).toBeNull();
    expect(await asUser(null, (tx) => tx.booking.count({ where: { serviceId: provider.serviceId } }))).toBe(0);
    expect(await asUser(stranger.id, (tx) => tx.bookingStatusHistory.count({ where: { bookingId } }))).toBe(0);
  });

  it("keeps an order's conversation between its customer and seller", async () => {
    const base = { sellerOrderId: shopSellerOrderId, businessId: shop.businessId };
    await asUser(buyer.id, (tx) => tx.message.create({ data: { ...base, sender: "customer", senderUserId: buyer.id, body: "Is it on the way?" } }));
    await asSeller(shop, (tx) => tx.message.create({ data: { ...base, sender: "seller", senderUserId: shop.userId, body: "Yes, GIG has it." } }));
    expect(await asUser(buyer.id, (tx) => tx.message.count({ where: { sellerOrderId: shopSellerOrderId } }))).toBe(2);
    expect(await asSeller(shop, (tx) => tx.message.count({ where: { sellerOrderId: shopSellerOrderId } }))).toBe(2);
    expect(await asSeller(provider, (tx) => tx.message.count({ where: { sellerOrderId: shopSellerOrderId } }))).toBe(0);
    expect(await asUser(stranger.id, (tx) => tx.message.count({ where: { sellerOrderId: shopSellerOrderId } }))).toBe(0);
    // Nobody can write into someone else's conversation, or as someone else.
    await expect(asUser(stranger.id, (tx) => tx.message.create({ data: { ...base, sender: "customer", senderUserId: stranger.id, body: "hi" } }))).rejects.toThrow();
    await expect(asSeller(provider, (tx) => tx.message.create({ data: { ...base, sender: "seller", senderUserId: provider.userId, body: "hi" } }))).rejects.toThrow();
    await expect(asUser(buyer.id, (tx) => tx.message.create({ data: { ...base, sender: "seller", senderUserId: buyer.id, body: "fake" } }))).rejects.toThrow();
    // Messages can't be edited or deleted; only marked read.
    await expect(asUser(buyer.id, (tx) => tx.message.updateMany({ where: { sellerOrderId: shopSellerOrderId }, data: { body: "changed" } }))).rejects.toThrow(/permission denied/);
    await expect(asSeller(shop, (tx) => tx.message.deleteMany({ where: { sellerOrderId: shopSellerOrderId } }))).rejects.toThrow(/permission denied/);
  });
});

describe("reviews", () => {
  let reviewId: string;
  let orderItemId: string;

  it("only lets the buyer review once the item is delivered", async () => {
    orderItemId = (await owner.orderItem.findFirstOrThrow({ where: { sellerOrderId: shopSellerOrderId } })).id;
    expect(await withSystemContext((tx) => findReviewable(tx, buyer.id, orderItemId))).toBeNull();
    await asSeller(shop, (tx) => advanceSellerOrder(tx, { sellerOrderId: shopSellerOrderId, businessId: shop.businessId, to: "delivered", actorUserId: shop.userId, escrowReleaseDays: 3 }));
    expect(await withSystemContext((tx) => findReviewable(tx, stranger.id, orderItemId))).toBeNull();
    const target = await withSystemContext((tx) => findReviewable(tx, buyer.id, orderItemId));
    expect(target).toMatchObject({ kind: "product", productId: shop.productId });
  });

  it("writes one review, refreshes the ratings and refuses a second", async () => {
    const r = await withSystemContext((tx) => writeReview(tx, { userId: buyer.id, userName: "Ada Obi", orderItemId, rating: 4, body: "Good soap", imageKeys: [] }));
    reviewId = r.id;
    const review = await owner.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.authorName).toBe("Ada O.");
    const product = await owner.product.findUniqueOrThrow({ where: { id: shop.productId } });
    expect([Number(product.ratingAvg), product.ratingCount]).toEqual([4, 1]);
    expect((await owner.business.findUniqueOrThrow({ where: { id: shop.businessId } })).ratingCount).toBe(1);
    await expect(withSystemContext((tx) => writeReview(tx, { userId: buyer.id, userName: "Ada Obi", orderItemId, rating: 1, body: "again", imageKeys: [] }))).rejects.toThrow();
  });

  it("refuses photos that aren't the reviewer's own uploads", async () => {
    await withSystemContext((tx) => tx.review.delete({ where: { id: reviewId } }));
    await expect(
      withSystemContext((tx) => writeReview(tx, { userId: buyer.id, userName: "Ada Obi", orderItemId, rating: 5, body: "x", imageKeys: [`reviews/u-${stranger.id}/x.webp`] })),
    ).rejects.toThrow(/upload your photos again/);
    reviewId = (await withSystemContext((tx) => writeReview(tx, { userId: buyer.id, userName: "Ada Obi", orderItemId, rating: 4, body: "Good soap", imageKeys: [] }))).id;
  });

  it("lets the seller reply, but not change the rating or hide the review", async () => {
    await asSeller(shop, (tx) => tx.review.update({ where: { id: reviewId }, data: { sellerReply: "Thank you!", sellerRepliedAt: new Date() } }));
    await expect(asSeller(shop, (tx) => tx.review.update({ where: { id: reviewId }, data: { rating: 5 } }))).rejects.toThrow(/permission denied/);
    await expect(asSeller(shop, (tx) => tx.review.update({ where: { id: reviewId }, data: { status: "hidden" } }))).rejects.toThrow(/Only TownMart/);
    expect((await asSeller(provider, (tx) => tx.review.updateMany({ where: { id: reviewId }, data: { sellerReply: "spam" } }))).count).toBe(0);
    await expect(asUser(buyer.id, (tx) => tx.review.create({ data: { targetType: "product", productId: shop.productId, businessId: shop.businessId, authorName: "x", rating: 5, body: "fake" } }))).rejects.toThrow();
  });

  it("hides a hidden review from everyone but its author, the seller and TownMart", async () => {
    await withSystemContext((tx) => tx.review.update({ where: { id: reviewId }, data: { status: "hidden" } }));
    expect(await asUser(null, (tx) => tx.review.findUnique({ where: { id: reviewId } }))).toBeNull();
    expect(await asUser(stranger.id, (tx) => tx.review.findUnique({ where: { id: reviewId } }))).toBeNull();
    expect(await asUser(buyer.id, (tx) => tx.review.findUnique({ where: { id: reviewId } }))).not.toBeNull();
    expect(await asSeller(shop, (tx) => tx.review.findUnique({ where: { id: reviewId } }))).not.toBeNull();
  });
});

describe("RLS: wishlists", () => {
  it("keeps each shopper's wishlist to themselves", async () => {
    await asUser(buyer.id, (tx) => tx.wishlistItem.create({ data: { userId: buyer.id, productId: shop.productId } }));
    expect(await asUser(buyer.id, (tx) => tx.wishlistItem.count())).toBe(1);
    expect(await asUser(stranger.id, (tx) => tx.wishlistItem.count({ where: { userId: buyer.id } }))).toBe(0);
    await expect(asUser(stranger.id, (tx) => tx.wishlistItem.create({ data: { userId: buyer.id, serviceId: provider.serviceId } }))).rejects.toThrow();
    expect((await asUser(stranger.id, (tx) => tx.wishlistItem.deleteMany({ where: { userId: buyer.id } }))).count).toBe(0);
  });
});
