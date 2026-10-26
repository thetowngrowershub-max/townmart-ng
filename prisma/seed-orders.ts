/**
 * Demo orders, bookings, messages and reviews, so the Phase 4 screens have
 * something in them straight after seeding. A demo shopper buys from two
 * shops (pay on delivery) and books two providers (paid online with the fake
 * provider); one parcel is delivered and reviewed, one booking is done and
 * reviewed, one waits for the provider to confirm.
 *
 * Every step goes through the same functions the app uses (placeOrder,
 * applyVerifiedPaymentTx, advanceSellerOrder, moveBooking, writeReview), in
 * the system scope. Idempotent: skipped when the demo shopper already exists.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";
import { afterBookingEnded } from "../lib/bookings/manage";
import { openSlots } from "../lib/bookings/schedule";
import { moveBooking } from "../lib/bookings/status";
import { computeCheckout } from "../lib/checkout/compute";
import { encrypt } from "../lib/crypto";
import {
  advanceSellerOrder,
  completeSellerOrder,
  markCashCollected,
} from "../lib/fulfilment/orders";
import { applyVerifiedPaymentTx } from "../lib/orders/payment";
import { placeOrder } from "../lib/orders/place";
import { writeReview } from "../lib/reviews/reviews";

type Tx = Prisma.TransactionClient;

const EMAIL = "bola@demo.townmart.ng";
const NAME = "Bola Adeyemi";
const DAY = 86_400_000;

/** The first open time of a service from `days` days ahead, as the slot picker would offer it. */
async function firstOpenSlot(
  tx: Tx,
  serviceId: string,
  days: number,
): Promise<Date> {
  const svc = await tx.service.findUniqueOrThrow({
    where: { id: serviceId },
    select: { durationMinutes: true },
  });
  const slots = await openSlots(tx, {
    serviceId,
    durationMinutes: svc.durationMinutes,
    from: lagosAt(days, 0),
    days: 7,
    leadMinutes: 120,
  });
  if (!slots[0]) throw new Error(`No open time for service ${serviceId}`);
  return slots[0].startsAt;
}

/** `days` from today at `hour`:00 Lagos time. */
function lagosAt(days: number, hour: number): Date {
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  return new Date(
    new Date(
      `${today}T${String(hour).padStart(2, "0")}:00:00+01:00`,
    ).getTime() +
      days * DAY,
  );
}

export async function seedDemoOrders(prisma: PrismaClient) {
  if (await prisma.user.findUnique({ where: { email: EMAIL } })) {
    console.log("• Demo orders already seeded");
    return;
  }
  const system = <T>(fn: (tx: Tx) => Promise<T>) =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
        return fn(tx);
      },
      { timeout: 60_000 },
    );

  const password = randomBytes(9).toString("base64url");
  // Created last-step-safe: if a step below fails, the shopper is removed so the next seed run tries again.
  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      name: NAME,
      emailVerified: new Date(),
      passwordHash: await hashPassword(password),
      roles: { create: [{ role: "customer" }] },
    },
  });
  const state = await prisma.state.findUniqueOrThrow({ where: { code: "LA" } });
  const lga = await prisma.lga.findFirstOrThrow({
    where: { stateId: state.id, slug: "ikeja" },
  });
  const address = {
    recipientName: NAME,
    phone: "08031234599",
    line1: "14 Toyin Street",
    line2: "",
    landmark: "Opposite the filling station",
    city: "Ikeja",
    stateId: state.id,
    lgaId: lga.id,
  };
  await prisma.address.create({
    data: {
      userId: user.id,
      label: "Home",
      recipientName: NAME,
      phoneEncrypted: encrypt(address.phone),
      line1Encrypted: encrypt(address.line1),
      landmark: address.landmark,
      city: "Ikeja",
      stateId: state.id,
      lgaId: lga.id,
      isDefault: true,
    },
  });

  const business = (slug: string) =>
    prisma.business.findUniqueOrThrow({
      where: { slug },
      select: { id: true, ownerUserId: true, name: true },
    });
  const variants = (businessId: string, take: number) =>
    prisma.productVariant.findMany({
      where: {
        businessId,
        isDefault: true,
        product: { status: "active", deletedAt: null },
      },
      orderBy: { createdAt: "asc" },
      take,
      select: { id: true },
    });
  const service = (businessSlug: string, slugStart: string) =>
    prisma.service.findFirstOrThrow({
      where: {
        business: { slug: businessSlug },
        slug: { startsWith: slugStart },
        status: "active",
      },
      select: { id: true, businessId: true },
    });

  /** Fills the shopper's cart, prices it and places the order, as the checkout page does. */
  async function buy(
    items: Prisma.CartItemCreateWithoutCartInput[],
    payment: "online" | "pay_on_delivery",
  ) {
    await prisma.cart.deleteMany({ where: { userId: user.id } });
    const cart = await prisma.cart.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + DAY),
        items: { create: items },
      },
    });
    return system(async (tx) => {
      const { quote } = await computeCheckout(tx, {
        cartId: cart.id,
        userId: user.id,
        address: { stateId: state.id, lgaId: lga.id },
      });
      const placed = await placeOrder(tx, {
        cartId: cart.id,
        userId: user.id,
        accountEmail: EMAIL,
        accountName: NAME,
        ipHash: "seed",
        data: {
          email: "",
          address,
          addressId: "",
          saveAddress: false,
          methods: {},
          payment,
          acceptTerms: true,
          marketingConsent: false,
          expectedTotalKobo: quote.totalKobo.toString(),
        },
      });
      if (payment === "online") {
        const reference = `seed-${randomUUID()}`;
        await tx.payment.create({
          data: {
            orderId: placed.orderId,
            provider: "fake",
            providerReference: reference,
            amountKobo: placed.totalKobo,
          },
        });
        await applyVerifiedPaymentTx(tx, reference, {
          reference,
          status: "success",
          amountKobo: placed.totalKobo,
          currency: "NGN",
          channel: "card",
          paidAt: new Date(),
          raw: { seed: true },
        });
      }
      return placed;
    });
  }

  const done: string[] = [];
  try {
    // 1. Groceries, pay on delivery: sent, delivered, paid in cash, completed, reviewed and answered.
    const fresh = await business("ikeja-fresh-mart");
    const groceries = await variants(fresh.id, 2);
    const o1 = await buy(
      groceries.map((v) => ({
        variant: { connect: { id: v.id } },
        business: { connect: { id: fresh.id } },
        qty: 1,
      })),
      "pay_on_delivery",
    );
    await system(async (tx) => {
      const so = await tx.sellerOrder.findFirstOrThrow({
        where: { orderId: o1.orderId },
      });
      const step = {
        sellerOrderId: so.id,
        businessId: fresh.id,
        actorUserId: fresh.ownerUserId,
        escrowReleaseDays: 3,
      };
      await advanceSellerOrder(tx, {
        ...step,
        to: "shipped",
        tracking: { number: "GIG-4471902", carrier: "GIG Logistics" },
      });
      await tx.message.create({
        data: {
          sellerOrderId: so.id,
          businessId: fresh.id,
          sender: "customer",
          senderUserId: user.id,
          body: "Good morning. Please can the rider call when he gets to Toyin Street?",
          readAt: new Date(),
        },
      });
      await tx.message.create({
        data: {
          sellerOrderId: so.id,
          businessId: fresh.id,
          sender: "seller",
          senderUserId: fresh.ownerUserId,
          body: "Good morning Bola, no problem. He will call you about 10 minutes before.",
        },
      });
      await advanceSellerOrder(tx, { ...step, to: "delivered" });
      await markCashCollected(tx, {
        sellerOrderId: so.id,
        businessId: fresh.id,
      });
      await completeSellerOrder(tx, {
        sellerOrderId: so.id,
        actorUserId: user.id,
        note: "The customer confirmed they received it",
      });
      const item = await tx.orderItem.findFirstOrThrow({
        where: { sellerOrderId: so.id },
        orderBy: { createdAt: "asc" },
      });
      const { id } = await writeReview(tx, {
        userId: user.id,
        userName: NAME,
        orderItemId: item.id,
        rating: 5,
        body: "Fresh, well packed and the rider was polite. Will order again.",
        imageKeys: [],
      });
      await tx.review.update({
        where: { id },
        data: {
          sellerReply: "Thank you Bola! See you next time.",
          sellerRepliedAt: new Date(),
        },
      });
    });
    done.push(`${o1.orderNumber} delivered and reviewed`);

    // 2. Farm produce, pay on delivery: waiting for the seller to send it.
    const farm = await business("ogun-harvest-farms");
    const produce = await variants(farm.id, 1);
    const o2 = await buy(
      produce.map((v) => ({
        variant: { connect: { id: v.id } },
        business: { connect: { id: farm.id } },
        qty: 1,
      })),
      "pay_on_delivery",
    );
    done.push(`${o2.orderNumber} waiting to be sent`);

    // 3. A plumber at home tomorrow morning, paid online: waiting for the provider to confirm.
    const pipe = await service("chukwudi-fixit-plumbing", "leaking-pipe");
    const o3 = await buy(
      [
        {
          service: { connect: { id: pipe.id } },
          business: { connect: { id: pipe.businessId } },
          bookingStartsAt: await system((tx) => firstOpenSlot(tx, pipe.id, 1)),
          atProvider: false,
          qty: 1,
        },
      ],
      "online",
    );
    done.push(`${o3.orderNumber} plumbing request`);

    // 4. Alterations at the tailor's: one booked for later this week, one done last week and reviewed.
    const alter = await service("mama-titi-couture", "clothing-alterations");
    const titi = await business("mama-titi-couture");
    const book = async (days: number) =>
      buy(
        [
          {
            service: { connect: { id: alter.id } },
            business: { connect: { id: alter.businessId } },
            bookingStartsAt: await system((tx) =>
              firstOpenSlot(tx, alter.id, days),
            ),
            atProvider: true,
            qty: 1,
          },
        ],
        "online",
      );
    const o4 = await book(3);
    done.push(`${o4.orderNumber} tailoring booked`);
    const o5 = await book(4);
    await system(async (tx) => {
      const b = await tx.booking.findFirstOrThrow({
        where: { orderId: o5.orderId },
      });
      // Demo history only: the booking is moved into last week before it's carried out.
      const startsAt = lagosAt(-6, 11);
      await tx.booking.update({
        where: { id: b.id },
        data: {
          startsAt,
          endsAt: new Date(
            startsAt.getTime() + (b.endsAt.getTime() - b.startsAt.getTime()),
          ),
        },
      });
      await moveBooking(tx, b, "in_progress", "Started", titi.ownerUserId);
      await moveBooking(
        tx,
        { ...b, status: "in_progress" },
        "completed",
        "Done",
        titi.ownerUserId,
      );
      await afterBookingEnded(tx, b.sellerOrderId);
      const { id } = await writeReview(tx, {
        userId: user.id,
        userName: NAME,
        orderItemId: b.orderItemId,
        rating: 4,
        body: "Neat work on my agbada, and ready on time. A little pricey but worth it.",
        imageKeys: [],
      });
      await tx.review.update({
        where: { id },
        data: {
          sellerReply: "Thank you for trusting Mama Titi Couture!",
          sellerRepliedAt: new Date(),
        },
      });
    });
    done.push(`${o5.orderNumber} tailoring done and reviewed`);
  } catch (err) {
    await system(async (tx) => {
      await tx.order.deleteMany({
        where: { userId: user.id, paymentStatus: { not: "paid" } },
      });
      await tx.user.delete({ where: { id: user.id } });
    }).catch(() => undefined);
    throw err;
  }
  await prisma.cart.deleteMany({ where: { userId: user.id } });
  console.log(
    `✓ Demo shopper ${EMAIL} / password: ${password}   (dev only): ${done.join("; ")}`,
  );
}
