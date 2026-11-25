import type { BookingStatus, Prisma } from "@prisma/client";
import type { FulfilmentContact, BookingLocation } from "@/lib/orders/place";
import { dateToLagosLocal, formatBookingTime, formatDay, formatTime } from "@/lib/datetime";
import type { Tx } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { sellerBookingSteps, type SellerBookingStep } from "./manage";
import { BOOKING_STATUS_LABELS } from "./status";

const ACTIVE: BookingStatus[] = ["requested", "confirmed", "in_progress"];

const canChange = (b: { status: BookingStatus; startsAt: Date }, now: Date) => (b.status === "requested" || b.status === "confirmed") && b.startsAt > now;

export type CustomerBookingRow = {
  id: string;
  serviceId: string;
  packageId: string | null;
  title: string;
  seller: string;
  when: string;
  where: string;
  status: string;
  statusKey: BookingStatus;
  payLater: string | null;
  orderNumber: string;
  canChange: boolean;
  canReview: boolean;
  orderItemId: string;
};

/** The shopper's bookings: coming up (soonest first) or past (latest first). Shopper RLS. */
export async function customerBookings(tx: Tx, userId: string, when: "upcoming" | "past", now = new Date()): Promise<CustomerBookingRow[]> {
  const where: Prisma.BookingWhereInput =
    when === "upcoming"
      ? { customerUserId: userId, status: { in: ACTIVE }, endsAt: { gt: now } }
      : { customerUserId: userId, OR: [{ status: { notIn: [...ACTIVE, "held"] } }, { endsAt: { lte: now } }] };
  const rows = await tx.booking.findMany({
    where,
    orderBy: { startsAt: when === "upcoming" ? "asc" : "desc" },
    take: 100,
    include: { orderItem: { select: { snapshot: true } }, sellerOrder: { select: { orderNumber: true, business: { select: { name: true } }, order: { select: { orderNumber: true } } } }, review: { select: { id: true } } },
  });
  return rows.map((b) => {
    const loc = b.locationSnapshot as BookingLocation;
    return {
      id: b.id,
      serviceId: b.serviceId,
      packageId: b.packageId,
      title: (b.orderItem.snapshot as { title: string }).title,
      seller: b.sellerOrder.business.name,
      when: formatBookingTime(b.startsAt),
      where: loc.kind === "customer" ? `At your address (${loc.lgaName})` : `At ${loc.businessName}, ${loc.city}`,
      status: BOOKING_STATUS_LABELS[b.status],
      statusKey: b.status,
      payLater: b.balanceKobo > 0n && ACTIVE.includes(b.status) ? formatPrice(b.balanceKobo) : null,
      orderNumber: b.sellerOrder.order.orderNumber,
      canChange: canChange(b, now),
      canReview: b.status === "completed" && !b.review,
      orderItemId: b.orderItemId,
    };
  });
}

export type SellerBookingRow = {
  id: string;
  serviceId: string;
  packageId: string | null;
  sellerOrderId: string;
  orderNumber: string;
  title: string;
  customer: string;
  time: string;
  where: string;
  status: string;
  statusKey: BookingStatus;
  payLater: string | null;
  steps: SellerBookingStep[];
  canChange: boolean;
};

export type SellerBookingDay = { date: string; label: string; rows: SellerBookingRow[] };

/**
 * A provider's bookings grouped by day (Lagos time): requests and coming
 * bookings from today on, or the past fortnight. Seller RLS.
 */
export async function sellerBookings(tx: Tx, businessId: string, view: "upcoming" | "requests" | "past", now = new Date()): Promise<{ days: SellerBookingDay[]; counts: { upcoming: number; requests: number } }> {
  const startOfToday = new Date(`${dateToLagosLocal(now).slice(0, 10)}T00:00:00+01:00`);
  const upcoming: Prisma.BookingWhereInput = { businessId, status: { in: ACTIVE }, endsAt: { gt: startOfToday } };
  const requests: Prisma.BookingWhereInput = { businessId, status: "requested", startsAt: { gt: now } };
  const where: Prisma.BookingWhereInput =
    view === "upcoming" ? upcoming : view === "requests" ? requests : { businessId, status: { not: "held" }, startsAt: { gte: new Date(now.getTime() - 14 * 86_400_000), lt: now } };
  const [rows, upcomingCount, requestCount] = await Promise.all([
    tx.booking.findMany({
      where,
      orderBy: { startsAt: view === "past" ? "desc" : "asc" },
      take: 300,
      include: { service: { select: { title: true } }, package: { select: { name: true } }, sellerOrder: { select: { orderNumber: true, fulfilmentContact: true } } },
    }),
    tx.booking.count({ where: upcoming }),
    tx.booking.count({ where: requests }),
  ]);
  const days = new Map<string, SellerBookingDay>();
  for (const b of rows) {
    const date = dateToLagosLocal(b.startsAt).slice(0, 10);
    const loc = b.locationSnapshot as BookingLocation;
    let day = days.get(date);
    if (!day) {
      const today = dateToLagosLocal(now).slice(0, 10);
      const tomorrow = dateToLagosLocal(new Date(now.getTime() + 86_400_000)).slice(0, 10);
      day = { date, label: date === today ? `Today · ${formatDay(b.startsAt)}` : date === tomorrow ? `Tomorrow · ${formatDay(b.startsAt)}` : formatDay(b.startsAt), rows: [] };
      days.set(date, day);
    }
    day.rows.push({
      id: b.id,
      serviceId: b.serviceId,
      packageId: b.packageId,
      sellerOrderId: b.sellerOrderId,
      orderNumber: b.sellerOrder.orderNumber,
      title: b.package ? `${b.service.title} · ${b.package.name}` : b.service.title,
      customer: (b.sellerOrder.fulfilmentContact as FulfilmentContact | null)?.name ?? "Customer",
      time: `${formatTime(b.startsAt)}–${formatTime(b.endsAt)}`,
      where: loc.kind === "customer" ? `Customer's address, ${loc.lgaName}` : "At your place",
      status: BOOKING_STATUS_LABELS[b.status],
      statusKey: b.status,
      payLater: b.balanceKobo > 0n ? formatPrice(b.balanceKobo) : null,
      steps: sellerBookingSteps(b, now),
      canChange: canChange(b, now),
    });
  }
  return { days: [...days.values()], counts: { upcoming: upcomingCount, requests: requestCount } };
}
