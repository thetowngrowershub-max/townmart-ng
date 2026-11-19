import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeCheckout } from "@/lib/checkout/compute";
import { loadDestination } from "@/lib/checkout/destination";
import { prisma, withRls, withSystemContext } from "@/lib/db";
import { FulfilmentError } from "@/lib/fulfilment/orders";
import { assignRider, riderCandidates } from "@/lib/fulfilment/riders";
import { nearerOffers } from "@/lib/catalogue/nearer";
import { roadMetres } from "@/lib/geo/distance";
import { placeOrder } from "@/lib/orders/place";
import { createUser, deleteMoneyTrail, deleteUsers, moweOgun, owner } from "./helpers";

/**
 * Delivery priced by distance (₦ per km from the shop to the customer's
 * location), and each shop's riders: only the shop sees them, and only its
 * own active riders can go on its deliveries.
 */

type Seller = { userId: string; businessId: string };
const tag = randomUUID().slice(0, 8);
const SHOP = { lat: 6.812, lng: 3.439 };
const HOME = { lat: 6.83, lng: 3.425 };
let shop: Seller & { variantId: string };
let other: Seller;
let riderId: string;
let otherRiderId: string;
const users: string[] = [];
const carts: string[] = [];

const asSystem = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
    return fn(tx);
  });
const asSeller = <T>(s: Seller, fn: (tx: Prisma.TransactionClient) => Promise<T>) => withRls({ userId: s.userId, businessId: s.businessId }, fn);

async function business(label: string, point: { lat: number; lng: number } | null): Promise<Seller> {
  const user = await createUser(label);
  users.push(user.id);
  const { stateId, lgaId } = await moweOgun();
  const b = await asSystem((tx) =>
    tx.business.create({
      data: {
        ownerUserId: user.id,
        type: "merchant",
        name: `${label} ${tag}`,
        slug: `${label}-${tag}`,
        email: `${label}-${tag}@test.townmart.local`,
        phoneEncrypted: "v1.k1.test.test.test",
        phoneHash: `${label}-${tag}`,
        addressEncrypted: "v1.k1.test.test.test",
        city: "Mowe",
        stateId,
        lgaId,
        latitude: point?.lat ?? null,
        longitude: point?.lng ?? null,
        status: "approved",
        policy: { create: { acceptsPayOnDelivery: true, deliveryOptions: { delivery: true, pickup: false } } },
      },
    }),
  );
  return { userId: user.id, businessId: b.id };
}

async function newCart() {
  const c = await owner.cart.create({
    data: { guestTokenHash: `test-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000), items: { create: [{ variantId: shop.variantId, businessId: shop.businessId, qty: 1 }] } },
  });
  carts.push(c.id);
  return c.id;
}

beforeAll(async () => {
  const cat = (await owner.category.findFirstOrThrow({ where: { kind: "product", isActive: true, parentId: { not: null }, isFood: false } })).id;
  const s = await business("dr-shop", SHOP);
  // A second shop right by the shopper's home, selling the same rice.
  other = await business("dr-other", { lat: HOME.lat + 0.001, lng: HOME.lng });
  const variantId = await asSystem(async (tx) => {
    const p = await tx.product.create({ data: { businessId: s.businessId, categoryId: cat, title: `Rice ${tag}`, slug: `dr-rice-${tag}`, basePriceKobo: 500_000n, status: "active" } });
    return (await tx.productVariant.create({ data: { productId: p.id, businessId: s.businessId, sku: `dr-${tag}`, priceKobo: 500_000n, stockQty: 20, isDefault: true } })).id;
  });
  shop = { ...s, variantId };
  await asSystem(async (tx) => {
    const p = await tx.product.create({ data: { businessId: other.businessId, categoryId: cat, title: `Rice ${tag}`, slug: `dr-rice2-${tag}`, basePriceKobo: 480_000n, status: "active" } });
    await tx.productVariant.create({ data: { productId: p.id, businessId: other.businessId, sku: `dr2-${tag}`, priceKobo: 480_000n, stockQty: 5, isDefault: true } });
  });
  riderId = (await asSeller(shop, (tx) => tx.rider.create({ data: { businessId: shop.businessId, name: "Musa", phoneEncrypted: "v1.k1.test.test.test", phoneHash: `r1-${tag}` } }))).id;
  otherRiderId = (await asSeller(other, (tx) => tx.rider.create({ data: { businessId: other.businessId, name: "Not yours", phoneEncrypted: "v1.k1.test.test.test", phoneHash: `r2-${tag}` } }))).id;
}, 60_000);

afterAll(async () => {
  const businessIds = [shop.businessId, other.businessId];
  const orderIds = (await owner.sellerOrder.findMany({ where: { businessId: { in: businessIds } }, select: { orderId: true } })).map((o) => o.orderId);
  await asSystem(async (tx) => {
    await deleteMoneyTrail(tx, { businessIds, orderIds });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    await tx.cart.deleteMany({ where: { id: { in: carts } } });
    await tx.rider.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.product.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.business.deleteMany({ where: { id: { in: businessIds } } });
  });
  await deleteUsers(...users);
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("delivery priced by distance", () => {
  it("charges ₦250 per km from the shop to the shopper's location", async () => {
    const { stateId, lgaId } = await moweOgun();
    const cartId = await newCart();
    const { destination } = await withRls({ userId: null }, (tx) => loadDestination(tx, { userId: null, stateId, lgaId, gps: HOME }));
    expect(destination?.point?.source).toBe("gps");
    const c = await withSystemContext((tx) => computeCheckout(tx, { cartId, userId: null, address: destination }));
    const km = Math.ceil(roadMetres(SHOP, HOME, 1.3) / 1000);
    expect(c.sellers[0]!.delivery?.distance?.chargedKm).toBe(km);
    expect(c.quote.deliveryKobo).toBe(BigInt(km) * 25_000n);
  });

  it("estimates from the town centre without a location, and the order keeps the distance", async () => {
    const { stateId, lgaId } = await moweOgun();
    const cartId = await newCart();
    const { destination } = await withRls({ userId: null }, (tx) => loadDestination(tx, { userId: null, stateId, lgaId }));
    expect(destination?.point?.source).toBe("area");
    const c = await withSystemContext((tx) => computeCheckout(tx, { cartId, userId: null, address: destination }));
    const placed = await withSystemContext((tx) =>
      placeOrder(tx, {
        cartId,
        userId: null,
        accountEmail: null,
        accountName: null,
        ipHash: "test",
        data: {
          email: `guest-${randomUUID()}@test.townmart.local`,
          address: { recipientName: "Ada Obi", phone: "08031234567", line1: "12 Allen Avenue", line2: "", landmark: "", city: "Mowe", stateId, lgaId },
          addressId: "",
          gps: null,
          saveAddress: false,
          methods: {},
          payment: "pay_on_delivery",
          acceptTerms: true,
          marketingConsent: false,
          expectedTotalKobo: c.quote.totalKobo.toString(),
        },
      }),
    );
    const so = await owner.sellerOrder.findFirstOrThrow({ where: { orderId: placed.orderId } });
    expect(so.deliveryKobo).toBe(c.quote.deliveryKobo);
    expect(so.deliveryDistanceM).toBe(c.sellers[0]!.delivery?.distance?.metres);
    expect((so.fulfilmentContact as { point?: { source: string } }).point?.source).toBe("area");
  }, 60_000);
});

describe("nearer shop", () => {
  it("points out the same item at a shop nearer the shopper", async () => {
    const cartId = await newCart();
    const { offers, far } = await withSystemContext(async (tx) => {
      const c = await computeCheckout(tx, { cartId, userId: null, address: null });
      return { offers: await nearerOffers(tx, c.lines, HOME), far: await nearerOffers(tx, c.lines, SHOP) };
    });
    expect([...offers.values()]).toMatchObject([{ productSlug: `dr-rice2-${tag}`, storeName: `dr-other ${tag}` }]);
    // Standing at the cart's shop, nothing is nearer.
    expect(far.size).toBe(0);
  });
});

describe("riders", () => {
  it("are only visible to their own shop", async () => {
    expect(await asSeller(other, (tx) => tx.rider.findMany({ where: { id: riderId } }))).toHaveLength(0);
    expect(await withRls({ userId: shop.userId }, (tx) => tx.rider.findMany({ where: { id: riderId } }))).toHaveLength(0);
    expect(await asSeller(shop, (tx) => tx.rider.findMany({ where: { id: riderId } }))).toHaveLength(1);
  });

  it("are suggested nearest first, and assigned only to their own shop's deliveries", async () => {
    const so = await owner.sellerOrder.findFirstOrThrow({ where: { businessId: shop.businessId } });
    const ranked = await asSeller(shop, (tx) => riderCandidates(tx, shop.businessId, 5));
    expect(ranked.map((r) => r.id)).toEqual([riderId]);
    expect(ranked[0]!.suggested).toBe(true);

    await expect(asSeller(shop, (tx) => assignRider(tx, { sellerOrderId: so.id, businessId: shop.businessId, riderId: otherRiderId, actorUserId: shop.userId }))).rejects.toBeInstanceOf(FulfilmentError);
    // Even skipping the app's check, the database won't put another shop's rider on the order.
    await expect(asSeller(shop, (tx) => tx.sellerOrder.update({ where: { id: so.id }, data: { riderId: otherRiderId, riderAssignedAt: new Date() } }))).rejects.toThrow();

    await asSeller(shop, (tx) => assignRider(tx, { sellerOrderId: so.id, businessId: shop.businessId, riderId, actorUserId: shop.userId }));
    const after = await owner.sellerOrder.findUniqueOrThrow({ where: { id: so.id } });
    expect(after.riderId).toBe(riderId);
    expect(after.riderAssignedAt).not.toBeNull();
    const notes = await owner.orderStatusHistory.findMany({ where: { sellerOrderId: so.id }, select: { note: true } });
    expect(notes.map((n) => n.note)).toContain("Rider assigned: Musa");

    // Busy now: still listed, no longer the suggestion.
    const busy = await asSeller(shop, (tx) => riderCandidates(tx, shop.businessId, 5));
    expect(busy[0]).toMatchObject({ activeJobs: 1, suggested: false });

    await asSeller(shop, (tx) => assignRider(tx, { sellerOrderId: so.id, businessId: shop.businessId, riderId: null, actorUserId: shop.userId }));
    expect((await owner.sellerOrder.findUniqueOrThrow({ where: { id: so.id } })).riderAssignedAt).toBeNull();
  });
});
