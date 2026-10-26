import { decrypt } from "@/lib/crypto";
import { formatDateTime } from "@/lib/datetime";
import { withSystemContext } from "@/lib/db";
import { env } from "@/lib/env";
import { formatPrice } from "@/lib/money";
import { orderReceiptTemplate, sellerNewOrderTemplate, type ReceiptSeller } from "@/lib/notifications/email/templates";
import { enqueueEmail, enqueueLowStockAlert, enqueueSms } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { orderAccessToken, type ShippingSnapshot } from "./place";

const qtyLabel = (q: { toString(): string }) => q.toString();
const optionsLabel = (o: unknown) => Object.values((o ?? {}) as Record<string, string>).join(", ");

/** Where a shopper opens their order: their account, or the guest link. */
export function orderUrl(order: { id: string; orderNumber: string; isGuest: boolean }): string {
  const base = env().APP_URL;
  return order.isGuest ? `${base}/checkout/complete/${order.orderNumber}?t=${orderAccessToken(order.id)}` : `${base}/account/orders/${order.orderNumber}`;
}

/**
 * Worker handler for "order.confirmed" (paid, or placed with pay on delivery):
 * the shopper's receipt by email and SMS, an email and in-app note for each
 * seller, and low-stock alerts. Safe to retry: it finishes once per order.
 */
export async function sendOrderConfirmed(orderId: string): Promise<boolean> {
  const doneKey = `order-confirmed-sent:${orderId}`;
  if (await redis.get(doneKey)) return false;

  const order = await withSystemContext((tx) =>
    tx.order.findUnique({
      where: { id: orderId },
      include: {
        sellerOrders: {
          orderBy: { createdAt: "asc" },
          include: {
            items: { orderBy: { createdAt: "asc" } },
            business: { select: { id: true, name: true, email: true, city: true, ownerUserId: true, policy: { select: { returnWindowDays: true } } } },
          },
        },
      },
    }),
  );
  if (!order || (order.paymentStatus !== "paid" && order.paymentStatus !== "pay_on_delivery")) return false;

  const pod = order.paymentStatus === "pay_on_delivery";
  const a = order.shippingAddressSnapshot as ShippingSnapshot;
  const sellers: ReceiptSeller[] = order.sellerOrders.map((so) => ({
    name: so.business.name,
    city: so.business.city,
    method: so.deliveryMethod,
    eta: so.etaDaysMin !== null && so.etaDaysMax !== null ? `${so.etaDaysMin}–${so.etaDaysMax} working days` : null,
    returnWindowDays: so.business.policy?.returnWindowDays ?? 7,
    items: so.items.map((i) => {
      const snap = i.snapshot as { title: string; options: unknown };
      return { title: snap.title, options: optionsLabel(snap.options), qty: qtyLabel(i.qty), total: formatPrice(i.lineTotalKobo), discount: i.discountKobo > 0n ? formatPrice(i.discountKobo) : null };
    }),
    subtotal: formatPrice(so.subtotalKobo - so.discountKobo),
    delivery: so.deliveryMethod === "pickup" ? "Pickup" : so.deliveryKobo === 0n ? "Free" : formatPrice(so.deliveryKobo),
  }));
  const url = orderUrl(order);

  await enqueueEmail(
    orderReceiptTemplate({
      to: order.contactEmail,
      name: order.customerName,
      orderNumber: order.orderNumber,
      placedAt: formatDateTime(order.placedAt),
      payOnDelivery: pod,
      sellers,
      totals: {
        subtotal: formatPrice(order.subtotalKobo),
        discount: order.discountKobo > 0n ? formatPrice(order.discountKobo) : null,
        delivery: order.deliveryKobo === 0n ? "Free" : formatPrice(order.deliveryKobo),
        serviceFee: formatPrice(order.serviceFeeKobo),
        vat: formatPrice(order.vatKobo),
        total: formatPrice(order.totalKobo),
      },
      address: `${a.city}, ${a.lgaName}, ${a.stateName}`,
      orderUrl: url,
      refundPolicyUrl: `${env().APP_URL}/legal/refunds`,
    }),
  );
  await enqueueSms({
    to: decrypt(order.contactPhoneEncrypted),
    body: pod
      ? `TownMart: order ${order.orderNumber} placed. Pay ${formatPrice(order.totalKobo)} on delivery. Details in your email.`
      : `TownMart: payment of ${formatPrice(order.totalKobo)} received for order ${order.orderNumber}. Thank you!`,
  });

  for (const so of order.sellerOrders) {
    await enqueueEmail(
      sellerNewOrderTemplate({
        to: so.business.email,
        businessName: so.business.name,
        orderNumber: order.orderNumber,
        payOnDelivery: pod,
        method: so.deliveryMethod,
        items: so.items.map((i) => ({ title: (i.snapshot as { title: string }).title, options: optionsLabel((i.snapshot as { options: unknown }).options), qty: qtyLabel(i.qty) })),
        net: formatPrice(so.sellerNetKobo),
        url: `${env().APP_URL}/dashboard`,
      }),
    );
  }

  await withSystemContext(async (tx) => {
    const link = `/account/orders/${order.orderNumber}`;
    const notes = [
      ...(order.userId ? [{ userId: order.userId, type: "order.confirmed", title: `Order ${order.orderNumber} confirmed`, body: pod ? `Pay ${formatPrice(order.totalKobo)} on delivery.` : `We've received your payment of ${formatPrice(order.totalKobo)}.`, link }] : []),
      ...order.sellerOrders.map((so) => ({
        userId: so.business.ownerUserId,
        type: "order.new",
        title: `New order ${order.orderNumber}`,
        body: `${so.items.length} item${so.items.length === 1 ? "" : "s"} for ${so.business.name}${pod ? " (pay on delivery)" : ""}.`,
        link: "/dashboard",
      })),
    ];
    for (const n of notes) {
      // Retries don't duplicate the bell notification.
      const exists = await tx.notification.findFirst({ where: { userId: n.userId, type: n.type, title: n.title }, select: { id: true } });
      if (!exists) await tx.notification.create({ data: n });
    }
  });

  for (const so of order.sellerOrders) {
    const variantIds = so.items.flatMap((i) => (i.variantId ? [i.variantId] : []));
    if (variantIds.length) await enqueueLowStockAlert({ businessId: so.businessId, variantIds });
  }

  await redis.set(doneKey, "1", "EX", 30 * 86_400);
  return true;
}
