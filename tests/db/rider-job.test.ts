import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deliveryActivity, deliveryBoard } from "@/lib/admin/deliveries";
import { computeCheckout } from "@/lib/checkout/compute";
import { loadDestination } from "@/lib/checkout/destination";
import { encrypt } from "@/lib/crypto";
import { prisma, withRls, withSystemContext } from "@/lib/db";
import { loadConversation } from "@/lib/fulfilment/messages";
import { sendFulfilmentNotice } from "@/lib/fulfilment/notify";
import { DeliveryCodeError, deliveryCode, lockRiderJob, riderDelivered, riderJobToken, riderPickedUp } from "@/lib/fulfilment/rider-job";
import { loadRiderJob } from "@/lib/fulfilment/rider-job-view";
import { assignRider } from "@/lib/fulfilment/riders";
import { loadOrderDetail } from "@/lib/orders/view";
import { placeOrder } from "@/lib/orders/place";
import { createUser, deleteMoneyTrail, deleteUsers, moweOgun, owner } from "./helpers";

/**
 * The rider's side of a delivery: one job link (no account), picked up,
 * delivered only with the customer's code, and a seat in the order chat.
 * Admins see it all on the delivery board.
 */

type Seller = { userId: string; businessId: string };
const tag = randomUUID().slice(0, 8);
let shop: Seller & { variantId: string };
let musa: string;
let ade: string;
let shopperId: string;
let soId: string;
const users: string[] = [];
const carts: string[] = [];

const asSystem = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
    return fn(tx);
  });
const asSeller = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => withRls({ userId: shop.userId, businessId: shop.businessId }, fn);
const assign = (riderId: string | null) => asSeller((tx) => assignRider(tx, { sellerOrderId: soId, businessId: shop.businessId, riderId, actorUserId: shop.userId }));
const current = () => owner.sellerOrder.findUniqueOrThrow({ where: { id: soId } });

beforeAll(async () => {
  const user = await createUser("rj-shop");
  users.push(user.id);
  const shopper = await createUser("rj-shopper");
  users.push(shopper.id);
  shopperId = shopper.id;
  const { stateId, lgaId } = await moweOgun();
  const cat = (await owner.category.findFirstOrThrow({ where: { kind: "product", isActive: true, parentId: { not: null }, isFood: false } })).id;
  const b = await asSystem((tx) =>
    tx.business.create({
      data: {
        ownerUserId: user.id,
        type: "merchant",
        name: `Rj shop ${tag}`,
        slug: `rj-shop-${tag}`,
        email: `rj-${tag}@test.townmart.local`,
        phoneEncrypted: encrypt("+2348030000001"),
        phoneHash: `rj-${tag}`,
        addressEncrypted: encrypt("5 Market Road"),
        city: "Mowe",
        stateId,
        lgaId,
        latitude: 6.812,
        longitude: 3.439,
        status: "approved",
        policy: { create: { acceptsPayOnDelivery: true, deliveryOptions: { delivery: true, pickup: false } } },
      },
    }),
  );
  const variantId = await asSystem(async (tx) => {
    const p = await tx.product.create({ data: { businessId: b.id, categoryId: cat, title: `Beans ${tag}`, slug: `rj-beans-${tag}`, basePriceKobo: 300_000n, status: "active" } });
    return (await tx.productVariant.create({ data: { productId: p.id, businessId: b.id, sku: `rj-${tag}`, priceKobo: 300_000n, stockQty: 20, isDefault: true } })).id;
  });
  shop = { userId: user.id, businessId: b.id, variantId };
  const rider = (name: string, phone: string) => asSeller((tx) => tx.rider.create({ data: { businessId: b.id, name, phoneEncrypted: encrypt(phone), phoneHash: `${name}-${tag}` } }));
  musa = (await rider("Musa", "+2348031111111")).id;
  ade = (await rider("Ade", "+2348032222222")).id;

  const cart = await owner.cart.create({ data: { guestTokenHash: `test-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000), items: { create: [{ variantId, businessId: b.id, qty: 1 }] } } });
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
  // Make it a signed-in shopper's order, to check what they can see.
  await owner.order.update({ where: { id: placed.orderId }, data: { userId: shopperId, isGuest: false } });
  soId = (await owner.sellerOrder.findFirstOrThrow({ where: { orderId: placed.orderId } })).id;
}, 60_000);

afterAll(async () => {
  const businessIds = [shop.businessId];
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

describe("rider job link", () => {
  it("opens the job for the assigned rider, and dies when the rider is changed", async () => {
    expect(riderJobToken(await current())).toBeNull();
    await assign(musa);
    const first = riderJobToken(await current())!;
    const job = await loadRiderJob(first);
    expect(job).toMatchObject({ riderName: "Musa", orderNumber: expect.any(String), collect: { amount: expect.any(String) } });
    expect(job!.shop.lines[0]).toBe("5 Market Road");
    expect(job!.customer).toMatchObject({ name: "Ada Obi", phone: "08031234567", approximate: false });
    expect(job!.customer.lines).toContain("Near Total filling station");

    const r = await assign(ade);
    await sendFulfilmentNotice({ type: "rider.assigned", sellerOrderId: soId, at: r.assignedAt!.getTime() });
    expect(await loadRiderJob(first)).toBeNull();
    expect(await withSystemContext((tx) => lockRiderJob(tx, first))).toBeNull();
    expect((await loadRiderJob(riderJobToken(await current())!))?.riderName).toBe("Ade");
  });

  it("lets the shopper see who's bringing it, and the code", async () => {
    const so = await current();
    const view = await withRls({ userId: shopperId }, (tx) => loadOrderDetail(tx, { id: so.orderId }));
    expect(view!.sellers[0]!.rider).toEqual({ name: "Ade", phone: "+2348032222222", code: deliveryCode(so), onTheWay: false });
    // Another signed-in user can't read the shop's riders.
    expect(await withRls({ userId: shop.userId }, (tx) => tx.rider.findMany({ where: { id: ade } }))).toHaveLength(0);
  });
});

describe("pickup and delivery", () => {
  it("needs pickup first, then the customer's code", async () => {
    const token = riderJobToken(await current())!;
    const deliver = (code: string) =>
      withSystemContext(async (tx) => {
        const so = (await lockRiderJob(tx, token))!;
        return riderDelivered(tx, so, { code, riderName: "Ade", escrowReleaseDays: 3 });
      });
    await expect(deliver(deliveryCode(await current())!)).rejects.toThrow(/Picked up/);

    const moved = await withSystemContext(async (tx) => riderPickedUp(tx, (await lockRiderJob(tx, token))!, "Ade"));
    expect(moved).toBe(true);
    await sendFulfilmentNotice({ type: "order.status", sellerOrderId: soId, status: "shipped" });
    const picked = await current();
    expect(picked.status).toBe("shipped");
    expect(picked.pickedUpAt).not.toBeNull();

    const right = deliveryCode(picked)!;
    const wrong = right === "0000" ? "1111" : "0000";
    await expect(deliver(wrong)).rejects.toBeInstanceOf(DeliveryCodeError);
    await deliver(right);
    await sendFulfilmentNotice({ type: "order.status", sellerOrderId: soId, status: "delivered" });
    const done = await current();
    expect(done.status).toBe("delivered");
    expect(done.escrowReleaseAt).not.toBeNull();
    const notes = (await owner.orderStatusHistory.findMany({ where: { sellerOrderId: soId }, select: { note: true } })).map((n) => n.note);
    expect(notes).toEqual(expect.arrayContaining(["Rider assigned: Musa", "Rider changed to Ade", "Picked up by rider Ade", "Delivered by rider Ade, code confirmed"]));
  });
});

describe("three-way chat", () => {
  it("shows the rider's messages to the shop, without the rider marking anything read", async () => {
    await asSystem((tx) => tx.message.create({ data: { sellerOrderId: soId, businessId: shop.businessId, sender: "customer", senderUserId: shopperId, body: "Gate is blue" } }));
    const m = await withSystemContext((tx) => tx.message.create({ data: { sellerOrderId: soId, businessId: shop.businessId, sender: "rider", senderName: "Ade", body: "I'm outside" } }));
    await sendFulfilmentNotice({ type: "message.new", messageId: m.id });
    // The shopper and the shop were told at each step (texts go through the same calls).
    const told = await owner.notification.findMany({ where: { userId: { in: [shopperId, shop.userId] } }, select: { type: true, title: true } });
    expect(told.map((t) => t.title)).toEqual(expect.arrayContaining([expect.stringMatching(/^Rider assigned/), expect.stringMatching(/^On its way/), expect.stringMatching(/^Delivered/), expect.stringMatching(/Ade \(your rider\)/), expect.stringMatching(/^Rider message/)]));
    const riderView = await withSystemContext((tx) => loadConversation(tx, { sellerOrderId: soId, viewer: "rider", sellerName: "Shop", customerName: "Ada" }));
    expect(riderView.map((m) => [m.author, m.mine])).toEqual([
      ["Ada", false],
      ["Ade (rider)", true],
    ]);
    expect(await owner.message.count({ where: { sellerOrderId: soId, readAt: { not: null } } })).toBe(0);
    const sellerView = await asSeller((tx) => loadConversation(tx, { sellerOrderId: soId, viewer: "seller", sellerName: "Shop", customerName: "Ada" }));
    expect(sellerView[1]!.author).toBe("Ade (rider)");
    expect(await owner.message.count({ where: { sellerOrderId: soId, readAt: null } })).toBe(0);
  });
});

describe("admin delivery board", () => {
  it("lists the delivery with its rider and the activity log", async () => {
    const admin = await createUser("rj-admin");
    users.push(admin.id);
    const { board, activity } = await withRls({ scope: "admin", userId: admin.id }, async (tx) => ({ board: await deliveryBoard(tx), activity: await deliveryActivity(tx, 200) }));
    const row = board.rows.find((r) => r.sellerOrderId === soId);
    expect(row).toMatchObject({ stage: "delivered", rider: { name: "Ade", phone: "+2348032222222" }, payOnDelivery: true });
    expect(activity.filter((a) => a.sellerOrderId === soId).map((a) => a.text)).toContain("Delivered by rider Ade, code confirmed");
  });
});
