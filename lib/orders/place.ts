import { adjustStock, CatalogueError } from "@/lib/catalogue/products";
import { computeCheckout, type CheckoutComputation } from "@/lib/checkout/compute";
import { decrypt, encrypt, lookupHash, sha256 } from "@/lib/crypto";
import type { Tx } from "@/lib/db";
import { REFUND_POLICY_VERSION, TERMS_VERSION } from "@/lib/legal";
import { formatPrice } from "@/lib/money";
import type { CheckoutData } from "@/lib/validation/checkout";
import { recordStatus } from "./status";

export class OrderError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "price_changed" | "out_of_stock" | "promotion_used_up" = "invalid",
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
 * releases it if payment doesn't arrive.
 */
export async function placeOrder(
  tx: Tx,
  params: { cartId: string; userId: string | null; accountEmail: string | null; accountName: string | null; data: CheckoutData; ipHash: string },
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
    throw new OrderError(c.blockers[0]!, soldOut ? "out_of_stock" : "invalid");
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
      totalKobo: q.totalKobo,
      paymentStatus: pod ? "pay_on_delivery" : "unpaid",
      paymentMethod: pod ? "pay_on_delivery" : "paystack",
      couponCode: c.priced.coupon.state === "applied" ? c.priced.coupon.code : null,
      promotionPlan: c.priced.redemptions.map((r) => ({ promotionId: r.promotionId, couponId: r.couponId, discountKobo: r.discountKobo.toString() })),
      termsVersion: TERMS_VERSION,
      refundPolicyVersion: REFUND_POLICY_VERSION,
      marketingConsent: data.marketingConsent,
      // Filled in below: the token is derived from the order id.
      accessTokenHash: "",
      ipHash: params.ipHash,
      placedAt: now,
      paymentDueAt: pod ? null : new Date(now.getTime() + c.settings.stockHoldMinutes * 60_000),
    },
  });

  const accessToken = orderAccessToken(order.id);
  await tx.order.update({ where: { id: order.id }, data: { accessTokenHash: sha256(accessToken) } });

  const pricedByKey = new Map(c.priced.lines.map((l) => [l.key, l]));
  const sellerById = new Map(c.sellers.map((s) => [s.businessId, s]));
  // Lock variants in a fixed order so two checkouts can't deadlock.
  const lines = [...c.lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
  const sellerOrderIds = new Map<string, string>();

  for (const sq of q.sellers) {
    const s = sellerById.get(sq.businessId)!;
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
        deliveryMethod: s.method!,
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
    await tx.orderItem.create({
      data: {
        sellerOrderId,
        businessId: l.businessId,
        variantId: l.variantId,
        productId: l.productId,
        snapshot: { title: l.title, slug: l.slug, sku: l.sku, options: l.optionValues, imageKey: l.imageKey, unit: l.unit, promotions: p.promotions.map((x) => x.name) },
        unitPriceKobo: l.unitPriceKobo,
        qty: l.qty,
        subtotalKobo: p.subtotalKobo,
        discountKobo: p.discountKobo,
        lineTotalKobo: p.totalKobo,
      },
    });
    if (!l.trackInventory) continue;
    try {
      await adjustStock(tx, {
        businessId: l.businessId,
        variantId: l.variantId,
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
        variantId: l.variantId,
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

