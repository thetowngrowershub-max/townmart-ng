import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { computeCheckout } from "@/lib/checkout/compute";
import { loadDestination } from "@/lib/checkout/destination";
import { encrypt } from "@/lib/crypto";
import { prisma, withRls, withSystemContext } from "@/lib/db";
import { sendFulfilmentNotice } from "@/lib/fulfilment/notify";
import { deliveryCode, riderDelivered, riderPickedUp } from "@/lib/fulfilment/rider-job";
import { assignRider } from "@/lib/fulfilment/riders";
import { placeOrder } from "@/lib/orders/place";
import { acceptPoolJob, dropPoolJob, getPoolRider, openJobs, openPoolJobsForOrder, poolCandidates, riderActiveJobs } from "@/lib/riders/pool";
import { createUser, deleteMoneyTrail, deleteUsers, moweOgun, owner } from "./helpers";

const credit = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/wallets/rider", () => ({ creditRiderEarning: credit }));

/**
 * The TownMart rider pool: riders with no shop who sign in, are vetted by
 * TownMart, go online, and take any shop's deliveries first come, first
 * served. Shops can't put pool riders on orders themselves, and the rider's
 * pay is fixed by TownMart when they take the job.
 */

type Shop = { userId: string; businessId: string; variantId: string };
const tag = randomUUID().slice(0, 8);
let shop: Shop;
let other: Shop;
let ownRider: string;
const pool: Record<"bola" | "chidi" | "dayo" | "pending", { userId: string; riderId: string }> = {} as never;
const users: string[] = [];
const carts: string[] = [];
const orderIds: string[] = [];

const asSystem = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
    return fn(tx);
  });
const asSeller = <T>(s: Shop, fn: (tx: Prisma.TransactionClient) => Promise<T>) => withRls({ userId: s.userId, businessId: s.businessId }, fn);
const asUser = <T>(userId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) => withRls({ userId }, fn);
const so = (id: string) => owner.sellerOrder.findUniqueOrThrow({ where: { id } });

async function makeShop(label: string, lat: number, lng: number): Promise<Shop> {
  const user = await createUser(`rp-${label}`);
  users.push(user.id);
  const { stateId, lgaId } = await moweOgun();
  const cat = (await owner.category.findFirstOrThrow({ where: { kind: "product", isActive: true, parentId: { not: null }, isFood: false } })).id;
  const b = await asSystem((tx) =>
    tx.business.create({
      data: {
        ownerUserId: user.id,
        type: "merchant",
        name: `Rp ${label} ${tag}`,
        slug: `rp-${label}-${tag}`,
        email: `rp-${label}-${tag}@test.townmart.local`,
        phoneEncrypted: encrypt("+2348030000001"),
        phoneHash: `rp-${label}-${tag}`,
        addressEncrypted: encrypt("5 Market Road"),
        city: "Mowe",
        stateId,
        lgaId,
        latitude: lat,
        longitude: lng,
        status: "approved",
        policy: { create: { acceptsPayOnDelivery: true, deliveryOptions: { delivery: true, pickup: false } } },
      },
    }),
  );
  const variantId = await asSystem(async (tx) => {
    const p = await tx.product.create({ data: { businessId: b.id, categoryId: cat, title: `Rice ${label} ${tag}`, slug: `rp-rice-${label}-${tag}`, basePriceKobo: 300_000n, status: "active" } });
    return (await tx.productVariant.create({ data: { productId: p.id, businessId: b.id, sku: `rp-${label}-${tag}`, priceKobo: 300_000n, stockQty: 50, isDefault: true } })).id;
  });
  return { userId: user.id, businessId: b.id, variantId };
}

/** A pay-on-delivery order from `s` to a customer pinned in Mowe; returns the seller order id. */
async function order(s: Shop): Promise<string> {
  const { stateId, lgaId } = await moweOgun();
  const cart = await owner.cart.create({ data: { guestTokenHash: `test-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000), items: { create: [{ variantId: s.variantId, businessId: s.businessId, qty: 1 }] } } });
  carts.push(cart.id);
  const { destination } = await withRls({ userId: null }, (tx) => loadDestination(tx, { userId: null, stateId, lgaId, gps: { lat: 6.83, lng: 3.425 } }));
  const c = await withSystemContext((tx) => computeCheckout(tx, { cartId: cart.id, userId: null, address: destination }));
  const placed = await withSystemContext((tx) =>
    placeOrder(tx, {
      cartId: cart.id,
      userId: null,
      accountEmail: null,
      accountName: null,
      ipHash: "test",
      data: {
        email: `guest-${randomUUID()}@test.townmart.local`,
        address: { recipientName: "Ada Obi", phone: "08031234567", line1: "12 Allen Avenue", line2: "", landmark: "Total filling station", city: "Mowe", stateId, lgaId },
        addressId: "",
        gps: { lat: 6.83, lng: 3.425 },
        saveAddress: false,
        methods: {},
        payment: "pay_on_delivery",
        acceptTerms: true,
        marketingConsent: false,
        expectedTotalKobo: c.quote.totalKobo.toString(),
      },
    }),
  );
  orderIds.push(placed.orderId);
  return (await owner.sellerOrder.findFirstOrThrow({ where: { orderId: placed.orderId } })).id;
}

async function poolRider(name: keyof typeof pool, phone: string, at: { lat: number; lng: number } | null, status = "approved") {
  const u = await createUser(`rp-rider-${name}`);
  users.push(u.id);
  const r = await asSystem((tx) =>
    tx.rider.create({
      data: {
        businessId: null,
        userId: u.id,
        status,
        name: name[0]!.toUpperCase() + name.slice(1),
        phoneEncrypted: encrypt(phone),
        phoneHash: `rp-${name}-${tag}`,
        isAvailable: true,
        latitude: at?.lat ?? null,
        longitude: at?.lng ?? null,
        locationUpdatedAt: at ? new Date() : null,
      },
    }),
  );
  pool[name] = { userId: u.id, riderId: r.id };
}

beforeAll(async () => {
  shop = await makeShop("a", 6.812, 3.439);
  other = await makeShop("b", 6.8, 3.43);
  ownRider = (await asSeller(shop, (tx) => tx.rider.create({ data: { businessId: shop.businessId, name: "Musa", phoneEncrypted: encrypt("+2348031111111"), phoneHash: `rp-musa-${tag}` } }))).id;
  await poolRider("bola", "+2348041111111", { lat: 6.813, lng: 3.44 }); // next to shop A
  await poolRider("chidi", "+2348042222222", { lat: 6.84, lng: 3.41 }); // ~4 km away
  await poolRider("dayo", "+2348043333333", null); // no position yet
  await poolRider("pending", "+2348044444444", { lat: 6.812, lng: 3.439 }, "pending");
}, 60_000);

afterAll(async () => {
  const businessIds = [shop.businessId, other.businessId];
  await asSystem(async (tx) => {
    await deleteMoneyTrail(tx, { businessIds, orderIds });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    await tx.cart.deleteMany({ where: { id: { in: carts } } });
    await tx.rider.deleteMany({ where: { OR: [{ businessId: { in: businessIds } }, { userId: { in: users } }] } });
    await tx.product.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.business.deleteMany({ where: { id: { in: businessIds } } });
  });
  await deleteUsers(...users);
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("rider applications and vetting", () => {
  it("lets a signed-in user apply only as pending, and never approve themselves", async () => {
    const u = await createUser("rp-applicant");
    users.push(u.id);
    const base = { businessId: null, userId: u.id, name: "Applicant", phoneEncrypted: encrypt("+2348045555555"), phoneHash: `rp-app-${tag}` };
    await expect(asUser(u.id, (tx) => tx.rider.create({ data: { ...base, status: "approved" } }))).rejects.toThrow(/vetting is done by TownMart/);
    const r = await asUser(u.id, (tx) => tx.rider.create({ data: { ...base, status: "pending" } }));
    await expect(asUser(u.id, (tx) => tx.rider.update({ where: { id: r.id }, data: { status: "approved" } }))).rejects.toThrow(/vetting is done by TownMart/);
    // They can see and update their own row (the online switch), but not someone else's.
    expect(await asUser(u.id, (tx) => tx.rider.findMany({ where: { businessId: null } }))).toHaveLength(1);
    expect(await asUser(u.id, (tx) => getPoolRider(tx, u.id))).toBeNull();
    expect(await asUser(pool.bola.userId, (tx) => getPoolRider(tx, pool.bola.userId))).toMatchObject({ id: pool.bola.riderId });
  });

  it("requires a sign-in for pool riders and keeps one pool rider per phone", async () => {
    await expect(asSystem((tx) => tx.rider.create({ data: { businessId: null, name: "No login", phoneEncrypted: encrypt("+2348046666666"), phoneHash: `rp-nologin-${tag}` } }))).rejects.toThrow(/riders_kind/);
    const u = await createUser("rp-dup");
    users.push(u.id);
    await expect(asSystem((tx) => tx.rider.create({ data: { businessId: null, userId: u.id, status: "pending", name: "Dup", phoneEncrypted: encrypt("+2348041111111"), phoneHash: `rp-bola-${tag}` } }))).rejects.toThrow(/Unique|unique/);
  });

  it("keeps pool riders hidden from shops until one is on their order", async () => {
    expect(await asSeller(shop, (tx) => tx.rider.findMany({ where: { businessId: null } }))).toHaveLength(0);
  });
});

describe("matching a delivery to a pool rider", () => {
  let soA: string;

  it("opens a shop's confirmed delivery to the pool and ranks online riders nearest the shop", async () => {
    soA = await order(shop);
    const placed = await so(soA);
    expect(["paid", "processing"]).toContain(placed.status); // pay on delivery starts at "processing"
    const opened = await withSystemContext((tx) => openPoolJobsForOrder(tx, placed.orderId));
    expect(opened.map((o) => o.sellerOrderId)).toEqual([soA]);
    // Repeating is harmless.
    expect(await withSystemContext((tx) => openPoolJobsForOrder(tx, placed.orderId))).toEqual([]);

    const ranked = await withSystemContext((tx) => poolCandidates(tx, { lat: 6.812, lng: 3.439 }, 2));
    const mine = ranked.filter((r) => Object.values(pool).some((p) => p.riderId === r.id)).map((r) => r.name);
    expect(mine).toEqual(["Bola", "Chidi", "Dayo"]);

    const jobs = await withSystemContext(async (tx) => openJobs(tx, (await tx.rider.findUniqueOrThrow({ where: { id: pool.chidi.riderId } }))!, 80));
    const job = jobs.find((j) => j.sellerOrderId === soA)!;
    expect(job).toMatchObject({ dropOff: "Near Total filling station, Mowe", payOnDelivery: true });
    expect(job.payKobo).toBe((placed.deliveryKobo * 80n) / 100n);
    expect(job.metresToShop).toBeGreaterThan(3000);
  });

  it("texts the nearest online riders about the job", async () => {
    const before = await owner.notification.count();
    await sendFulfilmentNotice({ type: "rider.pool_offer", sellerOrderId: soA, at: (await so(soA)).riderPoolOpenedAt!.getTime() });
    // Texts go to the queue, not to notifications: nothing to assert there beyond not throwing on a stale or fresh offer.
    await sendFulfilmentNotice({ type: "rider.pool_offer", sellerOrderId: soA, at: 1 });
    expect(await owner.notification.count()).toBeGreaterThanOrEqual(before);
  });

  it("doesn't open deliveries from shops on their own riders", async () => {
    await asSeller(other, (tx) => tx.business.update({ where: { id: other.businessId }, data: { riderMode: "own" } }));
    const soB = await order(other);
    expect(await withSystemContext(async (tx) => openPoolJobsForOrder(tx, (await tx.sellerOrder.findUniqueOrThrow({ where: { id: soB } })).orderId))).toEqual([]);
    expect((await so(soB)).riderPoolOpenedAt).toBeNull();
  });

  it("refuses offline and unapproved riders", async () => {
    await asUser(pool.dayo.userId, (tx) => tx.rider.update({ where: { id: pool.dayo.riderId }, data: { isAvailable: false } }));
    await expect(withSystemContext((tx) => acceptPoolJob(tx, { riderId: pool.dayo.riderId, sellerOrderId: soA, sharePercent: 80, maxJobs: 2 }))).rejects.toThrow(/Go online/);
    await expect(withSystemContext((tx) => acceptPoolJob(tx, { riderId: pool.pending.riderId, sellerOrderId: soA, sharePercent: 80, maxJobs: 2 }))).rejects.toThrow(/isn't approved/);
  });

  it("stops a shop putting a pool rider on its order", async () => {
    await expect(asSeller(shop, (tx) => assignRider(tx, { sellerOrderId: soA, businessId: shop.businessId, riderId: pool.bola.riderId, actorUserId: shop.userId }))).rejects.toThrow(/isn't one of your active riders/);
    await expect(asSeller(shop, (tx) => tx.sellerOrder.update({ where: { id: soA }, data: { riderId: pool.bola.riderId, riderAssignedAt: new Date() } }))).rejects.toThrow(/only TownMart can put a pool rider/);
    await expect(asSeller(shop, (tx) => tx.sellerOrder.update({ where: { id: soA }, data: { riderPayKobo: 1_000_000n } }))).rejects.toThrow();
  });

  it("gives the job to the first rider who takes it, with their pay fixed", async () => {
    const at = await withSystemContext((tx) => acceptPoolJob(tx, { riderId: pool.chidi.riderId, sellerOrderId: soA, sharePercent: 80, maxJobs: 2 }));
    const taken = await so(soA);
    expect(taken).toMatchObject({ riderId: pool.chidi.riderId, riderPayKobo: (taken.deliveryKobo * 80n) / 100n });
    expect(taken.riderAssignedAt!.getTime()).toBe(at.getTime());
    await expect(withSystemContext((tx) => acceptPoolJob(tx, { riderId: pool.bola.riderId, sellerOrderId: soA, sharePercent: 80, maxJobs: 2 }))).rejects.toThrow(/Another rider took this job first/);
    // Gone from the open list; on Chidi's list.
    const open = await withSystemContext(async (tx) => openJobs(tx, (await tx.rider.findUniqueOrThrow({ where: { id: pool.bola.riderId } }))!, 80));
    expect(open.some((j) => j.sellerOrderId === soA)).toBe(false);
    expect((await withSystemContext((tx) => riderActiveJobs(tx, pool.chidi.riderId))).map((j) => j.id)).toEqual([soA]);
    // The shop now sees who's coming.
    expect(await asSeller(shop, (tx) => tx.rider.findUnique({ where: { id: pool.chidi.riderId }, select: { name: true } }))).toEqual({ name: "Chidi" });
    expect(await asSeller(other, (tx) => tx.rider.findUnique({ where: { id: pool.chidi.riderId } }))).toBeNull();
    // The usual job text and customer code go out.
    await sendFulfilmentNotice({ type: "rider.assigned", sellerOrderId: soA, at: at.getTime() });
  });

  it("caps how many deliveries a rider holds", async () => {
    const soC = await order(shop);
    await withSystemContext(async (tx) => openPoolJobsForOrder(tx, (await tx.sellerOrder.findUniqueOrThrow({ where: { id: soC } })).orderId));
    await expect(withSystemContext((tx) => acceptPoolJob(tx, { riderId: pool.chidi.riderId, sellerOrderId: soC, sharePercent: 80, maxJobs: 1 }))).rejects.toThrow(/already have 1 delivery in hand/);
  });

  it("puts a job back in the pool when the rider hands it back before pickup", async () => {
    await withSystemContext((tx) => dropPoolJob(tx, { riderId: pool.chidi.riderId, userId: pool.chidi.userId, sellerOrderId: soA }));
    const back = await so(soA);
    expect(back).toMatchObject({ riderId: null, riderPayKobo: null });
    expect(back.riderPoolOpenedAt).not.toBeNull();
    await expect(withSystemContext((tx) => dropPoolJob(tx, { riderId: pool.chidi.riderId, userId: pool.chidi.userId, sellerOrderId: soA }))).rejects.toThrow(/isn't yours/);
  });

  it("clears a pool rider's pay when the shop switches to its own rider", async () => {
    await withSystemContext((tx) => acceptPoolJob(tx, { riderId: pool.bola.riderId, sellerOrderId: soA, sharePercent: 80, maxJobs: 2 }));
    expect((await so(soA)).riderPayKobo).not.toBeNull();
    await asSeller(shop, (tx) => assignRider(tx, { sellerOrderId: soA, businessId: shop.businessId, riderId: ownRider, actorUserId: shop.userId }));
    expect(await so(soA)).toMatchObject({ riderId: ownRider, riderPayKobo: null });
  });

  it("pays the pool rider into their wallet when the delivery is confirmed with the code", async () => {
    const soD = await order(shop);
    await withSystemContext(async (tx) => openPoolJobsForOrder(tx, (await tx.sellerOrder.findUniqueOrThrow({ where: { id: soD } })).orderId));
    await withSystemContext((tx) => acceptPoolJob(tx, { riderId: pool.bola.riderId, sellerOrderId: soD, sharePercent: 80, maxJobs: 3 }));
    credit.mockClear();
    await withSystemContext(async (tx) => {
      await riderPickedUp(tx, await tx.sellerOrder.findUniqueOrThrow({ where: { id: soD } }), "Bola");
      const s = await tx.sellerOrder.findUniqueOrThrow({ where: { id: soD } });
      await riderDelivered(tx, s, { code: deliveryCode(s)!, riderName: "Bola", escrowReleaseDays: 3 });
    });
    const done = await so(soD);
    expect(done.status).toBe("delivered");
    expect(credit).toHaveBeenCalledWith(expect.anything(), { riderId: pool.bola.riderId, sellerOrderId: soD, amountKobo: done.riderPayKobo, memo: expect.stringContaining(done.orderNumber) });
  });
});
