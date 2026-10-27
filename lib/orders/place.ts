import { claimSlot, SlotTakenError } from "@/lib/bookings/schedule";
import { recordBookingStatus, startingStatus } from "@/lib/bookings/status";
import { adjustStock, CatalogueError } from "@/lib/catalogue/products";
import { computeCheckout, type CheckoutComputation } from "@/lib/checkout/compute";
import { decrypt, encrypt, lookupHash, sha256 } from "@/lib/crypto";
import type { Tx } from "@/lib/db";
import { recordAcceptances } from "@/lib/legal/documents";
import { formatPrice } from "@/lib/money";
import type { CheckoutData } from "@/lib/validation/checkout";
import { recordStatus } from "./status";

export class OrderError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "price_changed" | "out_of_stock" | "slot_taken" | "promotion_used_up" = "invalid",
  ) {
    super(message);
  }
}

export type ShippingSnapshot = {
  recipientName: string;
  phoneEncrypted: string;
  line1Encrypted: string;
  line2Encrypted: string | null;
  landmark: string | null;
  city: string;
  stateId: number;
  stateName: string;
  lgaId: number;
  lgaName: string;
};

/**
 * What a seller sees of the customer (data minimisation): the recipient's
 * name and phone, and the address only when the seller delivers there or
 * works there. Phone and street lines stay encrypted; the phone is hidden
 * 30 days after the order is completed.
 */
export type FulfilmentContact = {
  name: string;
  phoneEncrypted: string;
  address: { line1Encrypted: string; line2Encrypted: string | null; landmark: string | null; city: string; lgaName: string; stateName: string } | null;
};

/** Where a booking happens. */
export type BookingLocation =
  | { kind: "provider"; businessName: string; city: string }
  | { kind: "customer"; city: string; lgaId: number; lgaName: string; stateName: string };

export type PlacedOrder = {
  orderId: string;
  orderNumber: string;
  /** Opens the order page without signing in (guests); shown once. */
  accessToken: string;
  totalKobo: bigint;
  payment: "online" | "pay_on_delivery";
};

/**
 * The secret in a guest's order link. Derived from the order id with the
 * server's hashing key, so emails sent later (by the worker) can include the
 * same link; only its SHA-256 is stored.
 */
export const orderAccessToken = (orderId: string) => lookupHash(orderId, "order-access").slice(0, 40);

type ResolvedAddress = { snapshot: ShippingSnapshot; recipientName: string; phone: string };

async function resolveAddress(tx: Tx, data: CheckoutData, userId: string | null): Promise<ResolvedAddress> {
  if (data.addressId) {
    if (!userId) throw new OrderError("Please add a delivery address.");
    const a = await tx.address.findFirst({ where: { id: data.addressId, userId }, include: { state: true, lga: true } });
    if (!a) throw new OrderError("That address isn't on your account.");
    const phone = decrypt(a.phoneEncrypted);
    return {
      recipientName: a.recipientName,
      phone,
      snapshot: {
        recipientName: a.recipientName,
        phoneEncrypted: a.phoneEncrypted,
        line1Encrypted: a.line1Encrypted,
        line2Encrypted: a.line2Encrypted,
        landmark: a.landmark,
        city: a.city,
        stateId: a.stateId,
        stateName: a.state.name,
        lgaId: a.lgaId,
        lgaName: a.lga.name,
      },
    };
  }
  const n = data.address!;
  const lga = await tx.lga.findFirst({ where: { id: n.lgaId, stateId: n.stateId }, include: { state: true } });
  if (!lga) throw new OrderError("Choose an LGA in the selected state.");
  return {
    recipientName: n.recipientName,
    phone: n.phone,
    snapshot: {
      recipientName: n.recipientName,
      phoneEncrypted: encrypt(n.phone),
      line1Encrypted: encrypt(n.line1),
      line2Encrypted: n.line2 ? encrypt(n.line2) : null,
      landmark: n.landmark || null,
      city: n.city,
      stateId: n.stateId,
      stateName: lga.state.name,
      lgaId: lga.id,
      lgaName: lga.name,
    },
  };
}

/**
 * Places an order from the shopper's cart in one database transaction, in the
 * system scope (it takes stock from several sellers). Prices, discounts and
 * fees are worked out again here from the database; the order is refused if
 * the total differs from what the shopper was shown.
 *
 * Stock is taken off each variant now (a "reservation" movement). Row locks
 * on the variants serialise concurrent checkouts, so stock can't be oversold.
 * For online payment the hold lasts `stockHoldMinutes`; lib/orders/payment.ts
 * releases it if payment doesn't arrive. Booking times are claimed the same
 * way (a "held" booking), under a per-service advisory lock and the
 * bookings_no_overlap exclusion constraint.
 */
export async function placeOrder(
  tx: Tx,
  params: { cartId: string; userId: string | null; accountEmail: string | null; accountName: string | null; data: CheckoutData; ipHash: string; userAgent?: string | null },
): Promise<PlacedOrder> {
  const { data, userId } = params;
  const email = params.accountEmail ?? (data.email || null);
  if (!email) throw new OrderError("Enter your email address for the receipt.");

  const address = await resolveAddress(tx, data, userId);
  const c: CheckoutComputation = await computeCheckout(tx, {
    cartId: params.cartId,
    userId,
    address: { stateId: address.snapshot.stateId, lgaId: address.snapshot.lgaId },
    methods: data.methods,
  });
  if (c.blockers.length) {
    const soldOut = c.lines.some((l) => l.problem?.kind === "out_of_stock" || l.problem?.kind === "not_enough");
    const slotGone = c.lines.some((l) => l.problem?.kind === "slot_unavailable");
    throw new OrderError(c.blockers[0]!, soldOut ? "out_of_stock" : slotGone ? "slot_taken" : "invalid");
  }
  if (c.quote.totalKobo.toString() !== data.expectedTotalKobo) {
    throw new OrderError(`Prices or delivery fees changed since you opened checkout. The new total is ${formatPrice(c.quote.totalKobo)}; please check it and try again.`, "price_changed");
  }
  const pod = data.payment === "pay_on_delivery";
  if (pod && !c.payOnDeliveryAvailable) throw new OrderError("Pay on delivery isn't available for this order.");

  // Usage limits: lock the promotions being used so two last-use orders can't both pass.
  const promotionIds = c.priced.redemptions.map((r) => r.promotionId);
  if (promotionIds.length) {
    const locked = await tx.$queryRaw<{ id: string; name: string; usage_limit: number | null; redemption_count: number }[]>`
      SELECT id, name, usage_limit, redemption_count FROM promotions WHERE id = ANY(${promotionIds}::uuid[]) ORDER BY id FOR UPDATE`;
    const full = locked.find((p) => p.usage_limit !== null && p.redemption_count >= p.usage_limit);
    if (full) throw new OrderError(`“${full.name}” has just been fully used. Your cart has been updated; please review the new total.`, "promotion_used_up");
  }

  const now = c.now;
  const orderNumber = (await tx.$queryRaw<{ n: string }[]>`SELECT next_order_number() AS n`)[0]!.n;
  const q = c.quote;
  const order = await tx.order.create({
    data: {
      orderNumber,
      userId,
      contactEmail: email,
      contactPhoneEncrypted: encrypt(address.phone),
      customerName: params.accountName || address.recipientName,
      isGuest: userId === null,
      shippingAddressSnapshot: address.snapshot,
      subtotalKobo: q.subtotalKobo,
      discountKobo: q.discountKobo,
      deliveryKobo: q.deliveryKobo,
      serviceFeeKobo: q.serviceFeeKobo,
      vatKobo: q.vatKobo,
      payLaterKobo: q.payLaterKobo,
      totalKobo: q.totalKobo,
      paymentStatus: pod ? "pay_on_delivery" : "unpaid",
      paymentMethod: pod ? "pay_on_delivery" : "paystack",
      couponCode: c.priced.coupon.state === "applied" ? c.priced.coupon.code : null,
      promotionPlan: c.priced.redemptions.map((r) => ({ promotionId: r.promotionId, couponId: r.couponId, discountKobo: r.discountKobo.toString() })),
      // Filled in below, from the acceptance records.
      termsVersion: "",
      refundPolicyVersion: "",
      marketingConsent: data.marketingConsent,
      // Filled in below: the token is derived from the order id.
      accessTokenHash: "",
      ipHash: params.ipHash,
      placedAt: now,
      paymentDueAt: pod ? null : new Date(now.getTime() + c.settings.stockHoldMinutes * 60_000),
    },
  });

  const accessToken = orderAccessToken(order.id);
  const accepted = await recordAcceptances(tx, { context: "checkout", userId, orderId: order.id, ipHash: params.ipHash, userAgent: params.userAgent });
  await tx.order.update({ where: { id: order.id }, data: { accessTokenHash: sha256(accessToken), termsVersion: accepted.terms!, refundPolicyVersion: accepted.refunds! } });
  // Ticking the marketing box opts a signed-in shopper in; guests are tracked on the order.
  if (userId && data.marketingConsent) {
    await tx.notificationPreference.upsert({ where: { userId }, create: { userId, marketingEmail: true, marketingEmailAt: now }, update: { marketingEmail: true, marketingEmailAt: now } });
  }

  const pricedByKey = new Map(c.priced.lines.map((l) => [l.key, l]));
  const sellerById = new Map(c.sellers.map((s) => [s.businessId, s]));
  // Lock variants, then services, in a fixed order so two checkouts can't deadlock.
  const sortKey = (l: (typeof c.lines)[number]) => (l.kind === "product" ? `0${l.variantId}` : `1${l.booking!.serviceId}${l.booking!.startsAt.toISOString()}`);
  const lines = [...c.lines].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const sellerOrderIds = new Map<string, string>();

  for (const sq of q.sellers) {
    const s = sellerById.get(sq.businessId)!;
    const own = c.lines.filter((l) => l.businessId === sq.businessId);
    const needsAddress = s.method === "delivery" || own.some((l) => l.booking && !l.booking.atProvider);
    const a = address.snapshot;
    const contact: FulfilmentContact = {
      name: address.recipientName,
      phoneEncrypted: a.phoneEncrypted,
      address: needsAddress ? { line1Encrypted: a.line1Encrypted, line2Encrypted: a.line2Encrypted, landmark: a.landmark, city: a.city, lgaName: a.lgaName, stateName: a.stateName } : null,
    };
    const so = await tx.sellerOrder.create({
      data: {
        orderId: order.id,
        businessId: sq.businessId,
        orderNumber,
        payOnDelivery: pod,
        status: pod ? "processing" : "pending_payment",
        subtotalKobo: sq.subtotalKobo,
        discountKobo: sq.discountKobo,
        platformDiscountKobo: sq.platformDiscountKobo,
        deliveryKobo: sq.deliveryKobo,
        commissionKobo: sq.commissionKobo,
        sellerNetKobo: sq.sellerNetKobo,
        payLaterKobo: sq.payLaterKobo,
        deliveryMethod: s.method!,
        fulfilmentContact: contact,
        etaDaysMin: s.method === "delivery" ? (s.delivery?.etaDaysMin ?? null) : null,
        etaDaysMax: s.method === "delivery" ? (s.delivery?.etaDaysMax ?? null) : null,
      },
    });
    sellerOrderIds.set(sq.businessId, so.id);
    await recordStatus(tx, { sellerOrderId: so.id, businessId: sq.businessId, from: null, to: so.status, actorUserId: userId, note: pod ? "Order placed (pay on delivery)" : "Order placed, awaiting payment" });
  }

  for (const l of lines) {
    const p = pricedByKey.get(l.cartItemId)!;
    const sellerOrderId = sellerOrderIds.get(l.businessId)!;
    const item = await tx.orderItem.create({
      data: {
        sellerOrderId,
        businessId: l.businessId,
        variantId: l.variantId,
        productId: l.productId,
        serviceId: l.booking?.serviceId ?? null,
        packageId: l.booking?.packageId ?? null,
        snapshot: {
          kind: l.kind,
          title: l.title,
          slug: l.slug,
          sku: l.sku,
          options: l.optionValues,
          imageKey: l.imageKey,
          unit: l.unit,
          promotions: p.promotions.map((x) => x.name),
          ...(l.booking ? { startsAt: l.booking.startsAt.toISOString(), durationMinutes: l.booking.durationMinutes, atProvider: l.booking.atProvider } : {}),
        },
        unitPriceKobo: l.unitPriceKobo,
        qty: l.qty,
        subtotalKobo: p.subtotalKobo,
        discountKobo: p.discountKobo,
        lineTotalKobo: p.totalKobo,
      },
    });

    if (l.booking) {
      const b = l.booking;
      let place: Awaited<ReturnType<typeof claimSlot>>;
      try {
        place = await claimSlot(tx, { serviceId: b.serviceId, startsAt: b.startsAt, durationMinutes: b.durationMinutes, leadMinutes: c.settings.bookingLeadMinutes, now });
      } catch (err) {
        if (err instanceof SlotTakenError) throw new OrderError(`Sorry, the time you chose for “${l.title}” has just been booked. Please pick another time.`, "slot_taken");
        throw err;
      }
      const seller = sellerById.get(l.businessId)!;
      const location: BookingLocation = b.atProvider
        ? { kind: "provider", businessName: seller.name, city: `${seller.city}, ${seller.stateName}` }
        : { kind: "customer", city: address.snapshot.city, lgaId: address.snapshot.lgaId, lgaName: address.snapshot.lgaName, stateName: address.snapshot.stateName };
      const status = pod ? startingStatus(b.requiresConfirmation) : "held";
      const booking = await tx.booking.create({
        data: {
          orderId: order.id,
          sellerOrderId,
          orderItemId: item.id,
          businessId: l.businessId,
          serviceId: b.serviceId,
          packageId: b.packageId,
          customerUserId: userId,
          startsAt: b.startsAt,
          endsAt: place.endsAt,
          slotNo: place.slotNo,
          capacity: place.capacity,
          status,
          atProvider: b.atProvider,
          locationSnapshot: location,
          priceKobo: p.totalKobo,
          depositKobo: p.totalKobo - l.payLaterKobo,
          balanceKobo: l.payLaterKobo,
          holdExpiresAt: pod ? null : order.paymentDueAt,
        },
      });
      await recordBookingStatus(tx, { bookingId: booking.id, businessId: l.businessId, from: null, to: status, actorUserId: userId, note: pod ? "Booked (pay on the day)" : "Booked, awaiting payment" });
      continue;
    }

    if (!l.trackInventory) continue;
    const variantId = l.variantId!;
    try {
      await adjustStock(tx, {
        businessId: l.businessId,
        variantId,
        change: l.qty.negated(),
        reason: "reservation",
        referenceType: "order",
        referenceId: order.id,
        actorUserId: userId,
        note: `Order ${orderNumber}`,
      });
    } catch (err) {
      if (err instanceof CatalogueError) throw new OrderError(`Sorry, “${l.title}” just sold out or doesn't have enough stock left. Please update your cart.`, "out_of_stock");
      throw err;
    }
    await tx.stockReservation.create({
      data: {
        variantId,
        businessId: l.businessId,
        orderId: order.id,
        sellerOrderId,
        qty: l.qty,
        status: pod ? "converted" : "held",
        expiresAt: order.paymentDueAt ?? now,
      },
    });
  }

  // Pay on delivery commits the promotion uses now; online orders do it when payment is confirmed.
  if (pod) await writeRedemptions(tx, order.id, userId);

  if (data.saveAddress && userId && data.address && !data.addressId) {
    const n = data.address;
    const count = await tx.address.count({ where: { userId } });
    await tx.address.create({
      data: {
        userId,
        recipientName: n.recipientName,
        phoneEncrypted: address.snapshot.phoneEncrypted,
        line1Encrypted: address.snapshot.line1Encrypted,
        line2Encrypted: address.snapshot.line2Encrypted,
        landmark: n.landmark || null,
        city: n.city,
        stateId: n.stateId,
        lgaId: n.lgaId,
        isDefault: count === 0,
      },
    });
  }

  // The ordered items leave the cart; saved-for-later items stay.
  await tx.cartItem.deleteMany({ where: { cartId: params.cartId, savedForLater: false, id: { in: c.lines.map((l) => l.cartItemId) } } });
  await tx.cart.update({ where: { id: params.cartId }, data: { couponCode: null } });

  return { orderId: order.id, orderNumber, accessToken, totalKobo: q.totalKobo, payment: pod ? "pay_on_delivery" : "online" };
}

/** Records the order's promotion uses (from the plan saved on the order). Each use counts towards the promotion's limits. */
export async function writeRedemptions(tx: Tx, orderId: string, userId: string | null): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { promotionPlan: true } });
  const plan = order.promotionPlan as { promotionId: string; couponId: string | null; discountKobo: string }[];
  for (const r of plan) {
    await tx.promotionRedemption.create({ data: { promotionId: r.promotionId, couponId: r.couponId, orderId, userId, discountKobo: BigInt(r.discountKobo) } });
  }
}

