/**
 * Demo refunds, a dispute and a payout, so the Phase 5 screens have something
 * in them: the demo shopper returns one of two items from Yaba Threads (approved and paid back
 * after the money was released to the shop, which is then paid out), cancels
 * a phone case the shop hadn't started on, and disputes a declined refund on
 * a power bank, left open for TownMart to decide.
 *
 * Like the order seed, every step goes through the app's own functions, with
 * the fake payment and transfer providers (dev only). Idempotent: skipped
 * once the demo shopper has a refund.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as appPrisma } from "../lib/db";
import { openDispute, addDisputeMessage } from "../lib/disputes/core";
import { advanceSellerOrder } from "../lib/fulfilment/orders";
import { releaseSellerOrder } from "../lib/payouts/escrow";
import { createPayout, sendPayout } from "../lib/payouts/payouts";
import { redis } from "../lib/redis";
import { cancelPaidSellerOrder } from "../lib/refunds/cancel";
import { approveRefund, createRefundRequest, rejectRefund, sendRefund } from "../lib/refunds/core";
import { EMAIL, shopperKit } from "./seed-orders";

const DAY = 86_400_000;

export async function seedDemoMoney(prisma: PrismaClient) {
  // Demo sellers seeded before Phase 5 have no transfer recipient yet.
  await prisma.$executeRaw`
    UPDATE payout_accounts pa SET provider_recipient_code = 'RCP_demo_' || b.slug
      FROM businesses b
     WHERE b.id = pa.business_id AND pa.provider_subaccount_code LIKE 'ACCT_demo_%' AND pa.provider_recipient_code IS NULL`;

  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) return;
  if (await prisma.refund.findFirst({ where: { order: { userId: user.id } }, select: { id: true } })) {
    console.log("• Demo refunds already seeded");
    return;
  }
  if (process.env.PAYMENT_PROVIDER !== "fake" || process.env.BANK_VERIFIER !== "fake") {
    console.log("• Demo refunds skipped: they need PAYMENT_PROVIDER=fake and BANK_VERIFIER=fake");
    return;
  }
  const { system, buy, business, variants } = await shopperKit(prisma, user.id);
  const done: string[] = [];
  try {
    // 1. Two items, delivered a week ago and released to the shop; one goes back, then the shop is paid out.
    const threads = await business("yaba-threads");
    const clothes = await variants(threads.id, 2);
    const o1 = await buy(clothes.map((v) => ({ variant: { connect: { id: v.id } }, business: { connect: { id: threads.id } }, qty: 1 })), "online");
    const r1 = await system(async (tx) => {
      const so = await tx.sellerOrder.findFirstOrThrow({ where: { orderId: o1.orderId }, include: { items: { orderBy: { createdAt: "asc" } } } });
      const step = { sellerOrderId: so.id, businessId: threads.id, actorUserId: threads.ownerUserId, escrowReleaseDays: 3 };
      await advanceSellerOrder(tx, { ...step, to: "processing", now: new Date(Date.now() - 9 * DAY) });
      await advanceSellerOrder(tx, { ...step, to: "shipped", tracking: { number: "KWIK-88213", carrier: "Kwik Delivery" }, now: new Date(Date.now() - 8 * DAY) });
      await advanceSellerOrder(tx, { ...step, to: "delivered", now: new Date(Date.now() - 6 * DAY) });
      await releaseSellerOrder(tx, so.id);
      const req = await createRefundRequest(tx, {
        sellerOrderId: so.id,
        origin: "customer",
        requestedBy: user.id,
        reason: "not_as_described",
        details: "It is a size smaller than the listing says. I'd like to return it, please.",
        items: [{ orderItemId: so.items[0]!.id, qty: 1 }],
        includeDelivery: false,
        respondBy: new Date(Date.now() + 2 * DAY),
      });
      return approveRefund(tx, { refundId: req.id, businessId: threads.id, decidedBy: threads.ownerUserId, restockItemIds: [so.items[0]!.id], response: "Sorry about that. Please drop it with the rider when convenient." });
    });
    await sendRefund(r1.id);
    const payout = await system((tx) => createPayout(tx, { businessId: threads.id, requestedBy: null, minimumKobo: 0n }));
    if (typeof payout !== "string") await sendPayout(payout.id);
    done.push(`${o1.orderNumber} one item returned and refunded, shop paid out`);

    // 2. A phone case the shop hadn't started on: cancelled by the shopper with a full refund.
    const gadgets = await business("cv-gadget-hub");
    const [caseVariant, bankVariant] = await variants(gadgets.id, 2);
    const o2 = await buy([{ variant: { connect: { id: caseVariant!.id } }, business: { connect: { id: gadgets.id } }, qty: 1 }], "online");
    const r2 = await system(async (tx) => {
      const so = await tx.sellerOrder.findFirstOrThrow({ where: { orderId: o2.orderId } });
      return cancelPaidSellerOrder(tx, { sellerOrderId: so.id, orderId: o2.orderId, by: "customer", actorUserId: user.id, reason: "Ordered the wrong model" });
    });
    await sendRefund(r2.id);
    done.push(`${o2.orderNumber} cancelled and refunded`);

    // 3. A power bank delivered two days ago: refund declined by the shop, now with TownMart.
    const o3 = await buy([{ variant: { connect: { id: bankVariant!.id } }, business: { connect: { id: gadgets.id } }, qty: 1 }], "online");
    await system(async (tx) => {
      const so = await tx.sellerOrder.findFirstOrThrow({ where: { orderId: o3.orderId }, include: { items: true } });
      const step = { sellerOrderId: so.id, businessId: gadgets.id, actorUserId: gadgets.ownerUserId, escrowReleaseDays: 3 };
      await advanceSellerOrder(tx, { ...step, to: "processing", now: new Date(Date.now() - 4 * DAY) });
      await advanceSellerOrder(tx, { ...step, to: "shipped", tracking: { number: "GIG-5520117", carrier: "GIG Logistics" }, now: new Date(Date.now() - 3 * DAY) });
      await advanceSellerOrder(tx, { ...step, to: "delivered", now: new Date(Date.now() - 2 * DAY) });
      const req = await createRefundRequest(tx, {
        sellerOrderId: so.id,
        origin: "customer",
        requestedBy: user.id,
        reason: "damaged",
        details: "It stops charging after about ten minutes and gets very hot.",
        items: [{ orderItemId: so.items[0]!.id, qty: 1 }],
        includeDelivery: false,
        respondBy: new Date(Date.now() + DAY),
      });
      const rejected = await rejectRefund(tx, { refundId: req.id, businessId: gadgets.id, decidedBy: gadgets.ownerUserId, response: "We tested it before sending and it worked. It may be the cable you're using." });
      const dispute = await openDispute(tx, { sellerOrderId: so.id, orderId: o3.orderId, refundId: rejected.id, openedBy: user.id, party: "customer", reason: "I've tried three different cables and two sockets. It still cuts off and gets hot." });
      await addDisputeMessage(tx, { disputeId: dispute.id, party: "seller", senderUserId: gadgets.ownerUserId, body: "We're happy to test it again. The customer can bring it to our Computer Village shop any weekday." });
    });
    done.push(`${o3.orderNumber} disputed, waiting for TownMart`);
  } finally {
    await redis.quit().catch(() => undefined);
    await appPrisma.$disconnect();
  }
  console.log(`✓ Demo refunds: ${done.join("; ")}`);
}
