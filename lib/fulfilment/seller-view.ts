import type { BookingStatus, OrderStatus, Prisma } from "@prisma/client";
import { sellerBookingSteps, type SellerBookingStep } from "@/lib/bookings/manage";
import { BOOKING_STATUS_LABELS } from "@/lib/bookings/status";
import { decrypt } from "@/lib/crypto";
import { formatBookingTime, formatDateTime } from "@/lib/datetime";
import type { Tx } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import type { BookingLocation, FulfilmentContact } from "@/lib/orders/place";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import { mergeTimeline } from "./timeline";
import { publicImageUrl } from "@/lib/storage";
import { nextSteps, STEP_LABELS, type SellerStep } from "./orders";

/** The customer's phone is hidden from the seller this long after the order is completed. */
export const CONTACT_RETENTION_DAYS = 30;

export const ORDER_FILTERS = {
  open: { label: "To do", statuses: ["paid", "processing", "ready_for_pickup", "shipped"] },
  delivered: { label: "Delivered", statuses: ["delivered", "completed"] },
  cancelled: { label: "Cancelled", statuses: ["cancelled", "refund_requested", "refunded", "partially_refunded"] },
  all: { label: "All", statuses: null },
} as const satisfies Record<string, { label: string; statuses: readonly OrderStatus[] | null }>;
export type OrderFilter = keyof typeof ORDER_FILTERS;

export type SellerOrderRow = {
  id: string;
  orderNumber: string;
  placedAt: string;
  status: string;
  statusKey: OrderStatus;
  method: string;
  itemCount: number;
  customer: string;
  net: string;
  payOnDelivery: boolean;
  cashCollected: boolean;
  nextBooking: string | null;
};

const METHOD_LABELS = { delivery: "Delivery", pickup: "Pickup", none: "Booking" } as const;

/**
 * A seller's orders, newest first. Runs in the seller's RLS transaction, so
 * only their part of each order is visible. Orders still awaiting online
 * payment are left out: there's nothing to do for them yet.
 */
export async function listSellerOrders(tx: Tx, businessId: string, filter: OrderFilter, page: number, pageSize = 20): Promise<{ rows: SellerOrderRow[]; total: number; counts: Record<OrderFilter, number> }> {
  const base: Prisma.SellerOrderWhereInput = { businessId, status: { not: "pending_payment" } };
  const statuses = ORDER_FILTERS[filter].statuses;
  const where: Prisma.SellerOrderWhereInput = statuses ? { ...base, status: { in: [...statuses] } } : base;
  const [rows, total, ...counts] = await Promise.all([
    tx.sellerOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { items: true } },
        bookings: { where: { status: { in: ["requested", "confirmed", "in_progress"] } }, orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } },
      },
    }),
    tx.sellerOrder.count({ where }),
    ...(Object.keys(ORDER_FILTERS) as OrderFilter[]).map((f) => {
      const s = ORDER_FILTERS[f].statuses;
      return tx.sellerOrder.count({ where: s ? { ...base, status: { in: [...s] } } : base });
    }),
  ]);
  return {
    rows: rows.map((so) => ({
      id: so.id,
      orderNumber: so.orderNumber,
      placedAt: formatDateTime(so.createdAt),
      status: ORDER_STATUS_LABELS[so.status],
      statusKey: so.status,
      method: METHOD_LABELS[so.deliveryMethod],
      itemCount: so._count.items,
      customer: (so.fulfilmentContact as FulfilmentContact | null)?.name ?? "Customer",
      net: formatPrice(so.sellerNetKobo),
      payOnDelivery: so.payOnDelivery,
      cashCollected: so.cashCollectedAt !== null,
      nextBooking: so.bookings[0] ? formatBookingTime(so.bookings[0].startsAt) : null,
    })),
    total,
    counts: Object.fromEntries((Object.keys(ORDER_FILTERS) as OrderFilter[]).map((f, i) => [f, counts[i] ?? 0])) as Record<OrderFilter, number>,
  };
}

export type SellerOrderDetail = {
  id: string;
  orderNumber: string;
  placedAt: string;
  status: string;
  statusKey: OrderStatus;
  method: "delivery" | "pickup" | "none";
  methodLabel: string;
  payOnDelivery: boolean;
  cashCollectedAt: string | null;
  tracking: { carrier: string | null; number: string } | null;
  eta: string | null;
  customer: { name: string; phone: string | null; phoneHidden: boolean; address: string[] | null };
  items: {
    id: string;
    title: string;
    options: string;
    qty: string;
    unit: string;
    sku: string;
    unitPrice: string;
    total: string;
    imageUrl: string | null;
    booking: {
      id: string;
      serviceId: string;
      packageId: string | null;
      when: string;
      movedFrom: string | null;
      where: string;
      status: string;
      statusKey: BookingStatus;
      payLater: string | null;
      steps: SellerBookingStep[];
      canChange: boolean;
    } | null;
  }[];
  money: { subtotal: string; discount: string | null; delivery: string; commission: string; net: string; payLater: string | null };
  steps: { to: SellerStep; label: string }[];
  canCancel: boolean;
  canMarkCash: boolean;
  timeline: { label: string; note: string | null; at: string }[];
};

/** One seller order with what the seller needs to fulfil it. Seller RLS transaction. */
export async function loadSellerOrder(tx: Tx, businessId: string, id: string, now = new Date()): Promise<SellerOrderDetail | null> {
  const so = await tx.sellerOrder.findFirst({
    where: { id, businessId, status: { not: "pending_payment" } },
    include: {
      items: { orderBy: { createdAt: "asc" }, include: { booking: { include: { statusHistory: { orderBy: { createdAt: "asc" } } } } } },
      statusHistory: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!so) return null;
  const contact = so.fulfilmentContact as FulfilmentContact | null;
  const phoneHidden = so.completedAt !== null && so.completedAt.getTime() + CONTACT_RETENTION_DAYS * 86_400_000 < now.getTime();
  const a = contact?.address ?? null;
  return {
    id: so.id,
    orderNumber: so.orderNumber,
    placedAt: formatDateTime(so.createdAt),
    status: ORDER_STATUS_LABELS[so.status],
    statusKey: so.status,
    method: so.deliveryMethod,
    methodLabel: METHOD_LABELS[so.deliveryMethod],
    payOnDelivery: so.payOnDelivery,
    cashCollectedAt: so.cashCollectedAt ? formatDateTime(so.cashCollectedAt) : null,
    tracking: so.trackingNumber ? { carrier: so.carrier, number: so.trackingNumber } : null,
    eta: so.etaDaysMin !== null && so.etaDaysMax !== null ? `${so.etaDaysMin}–${so.etaDaysMax} working days` : null,
    customer: {
      name: contact?.name ?? "Customer",
      phone: contact && !phoneHidden ? decrypt(contact.phoneEncrypted) : null,
      phoneHidden,
      address: a
        ? [[decrypt(a.line1Encrypted), a.line2Encrypted ? decrypt(a.line2Encrypted) : null].filter(Boolean).join(", "), a.landmark ? `Near ${a.landmark}` : null, `${a.city}, ${a.lgaName}, ${a.stateName}`].filter(
            (x): x is string => Boolean(x),
          )
        : null,
    },
    items: so.items.map((i) => {
      const s = i.snapshot as { title: string; sku?: string; options?: Record<string, string>; imageKey?: string | null; unit?: string };
      const b = i.booking;
      const loc = b ? (b.locationSnapshot as BookingLocation) : null;
      return {
        id: i.id,
        title: s.title,
        options: Object.values(s.options ?? {}).join(", "),
        qty: i.qty.toString(),
        unit: s.unit ?? "",
        sku: s.sku ?? "",
        unitPrice: formatPrice(i.unitPriceKobo),
        total: formatPrice(i.lineTotalKobo),
        imageUrl: s.imageKey ? publicImageUrl(s.imageKey) : null,
        booking: b
          ? {
              id: b.id,
              serviceId: b.serviceId,
              packageId: b.packageId,
              when: formatBookingTime(b.startsAt),
              movedFrom: b.previousStartsAt ? formatBookingTime(b.previousStartsAt) : null,
              where: loc?.kind === "customer" ? `At the customer's address (${loc.lgaName})` : "At your place",
              status: BOOKING_STATUS_LABELS[b.status],
              statusKey: b.status,
              payLater: b.balanceKobo > 0n ? formatPrice(b.balanceKobo) : null,
              steps: sellerBookingSteps(b, now),
              canChange: (b.status === "requested" || b.status === "confirmed") && b.startsAt > now,
            }
          : null,
      };
    }),
    money: {
      subtotal: formatPrice(so.subtotalKobo),
      discount: so.discountKobo > 0n ? formatPrice(so.discountKobo) : null,
      delivery: so.deliveryMethod === "delivery" ? (so.deliveryKobo === 0n ? "Free" : formatPrice(so.deliveryKobo)) : "None",
      commission: formatPrice(so.commissionKobo),
      net: formatPrice(so.sellerNetKobo),
      payLater: so.payLaterKobo > 0n ? formatPrice(so.payLaterKobo) : null,
    },
    steps: nextSteps(so).map((to) => ({ to, label: STEP_LABELS[to] })),
    // Before handover; a paid order is cancelled with a full refund. Booking-only orders are cancelled booking by booking.
    canCancel: so.deliveryMethod !== "none" && (so.payOnDelivery ? ["processing", "ready_for_pickup"] : ["paid", "processing", "ready_for_pickup"]).includes(so.status),
    canMarkCash: so.payOnDelivery && !so.cashCollectedAt && (["shipped", "ready_for_pickup", "delivered", "completed"].includes(so.status) || so.deliveryMethod === "none"),
    timeline: mergeTimeline(so.statusHistory, so.items),
  };
}
