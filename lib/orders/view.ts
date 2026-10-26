import type { OrderPaymentStatus, OrderStatus, PaymentProviderName, Prisma } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { formatDateTime } from "@/lib/datetime";
import type { Tx } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { publicImageUrl } from "@/lib/storage";
import type { ShippingSnapshot } from "./place";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  processing: "Processing",
  ready_for_pickup: "Ready for pickup",
  shipped: "On its way",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  refund_requested: "Refund requested",
  refunded: "Refunded",
  partially_refunded: "Partly refunded",
};

export const PAYMENT_STATUS_LABELS: Record<OrderPaymentStatus, string> = {
  unpaid: "Not paid",
  paid: "Paid",
  failed: "Payment failed",
  pay_on_delivery: "Pay on delivery",
  refunded: "Refunded",
  partially_refunded: "Partly refunded",
};

export const PROVIDER_LABELS: Record<PaymentProviderName, string> = {
  paystack: "Paystack",
  flutterwave: "Flutterwave",
  pay_on_delivery: "Pay on delivery",
  fake: "Test payment",
};

const detailInclude = {
  sellerOrders: {
    orderBy: { createdAt: "asc" },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      business: { select: { name: true, slug: true, city: true } },
    },
  },
  payments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, provider: true, channel: true } },
} satisfies Prisma.OrderInclude;

export type OrderDetailView = {
  orderNumber: string;
  placedAt: string;
  status: "awaiting_payment" | "confirmed" | "cancelled";
  paymentStatus: string;
  paymentMethod: string;
  payOnDelivery: boolean;
  paymentDueAt: string | null;
  cancelReason: string | null;
  canPay: boolean;
  contactEmail: string;
  address: { recipientName: string; lines: string[] };
  sellers: {
    name: string;
    href: string;
    status: string;
    method: "delivery" | "pickup";
    eta: string | null;
    items: { title: string; href: string; options: string; qty: string; unitPrice: string; discount: string | null; total: string; imageUrl: string | null }[];
    subtotal: string;
    delivery: string;
  }[];
  totals: { subtotal: string; discount: string | null; delivery: string | null; serviceFee: string; vat: string; total: string; totalKobo: string };
};

/** Loads one order for its shopper. The caller has already checked they may see it. */
export async function loadOrderDetail(tx: Tx, where: { id: string } | { orderNumber: string }, now = new Date()): Promise<OrderDetailView | null> {
  const o = await tx.order.findUnique({ where: "id" in where ? { id: where.id } : { orderNumber: where.orderNumber }, include: detailInclude });
  if (!o) return null;
  const a = o.shippingAddressSnapshot as ShippingSnapshot;
  const pod = o.paymentStatus === "pay_on_delivery";
  const status = o.cancelledAt ? "cancelled" : o.paymentStatus === "unpaid" ? "awaiting_payment" : "confirmed";
  return {
    orderNumber: o.orderNumber,
    placedAt: formatDateTime(o.placedAt),
    status,
    paymentStatus: PAYMENT_STATUS_LABELS[o.paymentStatus],
    paymentMethod: PROVIDER_LABELS[o.paymentMethod],
    payOnDelivery: pod,
    paymentDueAt: o.paymentDueAt && status === "awaiting_payment" ? formatDateTime(o.paymentDueAt) : null,
    cancelReason: o.cancelReason,
    canPay: status === "awaiting_payment" && o.paymentDueAt !== null && o.paymentDueAt > now,
    contactEmail: o.contactEmail,
    address: {
      recipientName: a.recipientName,
      lines: [
        [decrypt(a.line1Encrypted), a.line2Encrypted ? decrypt(a.line2Encrypted) : null].filter(Boolean).join(", "),
        a.landmark ? `Near ${a.landmark}` : null,
        `${a.city}, ${a.lgaName}, ${a.stateName}`,
        decrypt(a.phoneEncrypted),
      ].filter((x): x is string => Boolean(x)),
    },
    sellers: o.sellerOrders.map((so) => ({
      name: so.business.name,
      href: `/store/${so.business.slug}`,
      status: ORDER_STATUS_LABELS[so.status],
      method: so.deliveryMethod,
      eta: so.etaDaysMin !== null && so.etaDaysMax !== null ? `${so.etaDaysMin}–${so.etaDaysMax} working days` : null,
      items: so.items.map((i) => {
        const s = i.snapshot as { title: string; slug: string; options: Record<string, string>; imageKey: string | null };
        return {
          title: s.title,
          href: `/p/${s.slug}`,
          options: Object.values(s.options ?? {}).join(", "),
          qty: i.qty.toString(),
          unitPrice: formatPrice(i.unitPriceKobo),
          discount: i.discountKobo > 0n ? formatPrice(i.discountKobo) : null,
          total: formatPrice(i.lineTotalKobo),
          imageUrl: s.imageKey ? publicImageUrl(s.imageKey) : null,
        };
      }),
      subtotal: formatPrice(so.subtotalKobo - so.discountKobo),
      delivery: so.deliveryMethod === "pickup" ? "Pickup" : so.deliveryKobo === 0n ? "Free" : formatPrice(so.deliveryKobo),
    })),
    totals: {
      subtotal: formatPrice(o.subtotalKobo),
      discount: o.discountKobo > 0n ? formatPrice(o.discountKobo) : null,
      delivery: o.deliveryKobo === 0n ? "Free" : formatPrice(o.deliveryKobo),
      serviceFee: formatPrice(o.serviceFeeKobo),
      vat: formatPrice(o.vatKobo),
      total: formatPrice(o.totalKobo),
      totalKobo: o.totalKobo.toString(),
    },
  };
}
