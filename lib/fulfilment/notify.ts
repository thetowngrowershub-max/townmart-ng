import { BOOKING_STATUS_LABELS } from "@/lib/bookings/status";
import { decrypt } from "@/lib/crypto";
import { dateToLagosLocal, formatBookingTime } from "@/lib/datetime";
import { withSystemContext, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { formatPrice } from "@/lib/money";
import { noticeTemplate } from "@/lib/notifications/email/templates";
import { orderUrl } from "@/lib/orders/notify";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import { enqueueEmail, enqueueSms, type FulfilmentNotice } from "@/lib/queue";

type Customer = { id: string; orderNumber: string; isGuest: boolean; userId: string | null; contactEmail: string; contactPhoneEncrypted: string; customerName: string };
type Seller = { name: string; email: string; ownerUserId: string };

/** One in-app notification, written once even if the job is retried. */
async function inApp(tx: Tx, n: { userId: string; type: string; title: string; body: string; link: string }) {
  const exists = await tx.notification.findFirst({ where: { userId: n.userId, type: n.type, title: n.title, link: n.link }, select: { id: true } });
  if (!exists) await tx.notification.create({ data: n });
}

/** The customer's way back to their order: their account page, or the guest link. */
const customerLink = (o: Customer) => ({ url: orderUrl(o), path: `/account/orders/${o.orderNumber}` });

async function tellCustomer(tx: Tx, o: Customer, p: { type: string; title: string; lines: string[]; sms: string | null }) {
  const link = customerLink(o);
  await enqueueEmail(noticeTemplate({ to: o.contactEmail, subject: `${p.title} · ${o.orderNumber}`, title: p.title, lines: [`Hi ${o.customerName},`, ...p.lines], url: link.url, buttonLabel: "View your order" }));
  if (p.sms) await enqueueSms({ to: decrypt(o.contactPhoneEncrypted), body: `TownMart: ${p.sms}` });
  if (o.userId) await inApp(tx, { userId: o.userId, type: p.type, title: p.title, body: p.lines[0] ?? "", link: link.path });
}

async function tellSeller(tx: Tx, s: Seller, p: { type: string; title: string; lines: string[]; path: string }) {
  await enqueueEmail(noticeTemplate({ to: s.email, subject: p.title, title: p.title, lines: p.lines, url: `${env().APP_URL}${p.path}`, buttonLabel: "Open in your dashboard" }));
  await inApp(tx, { userId: s.ownerUserId, type: p.type, title: p.title, body: p.lines[0] ?? "", link: p.path });
}

const customerSelect = { id: true, orderNumber: true, isGuest: true, userId: true, contactEmail: true, contactPhoneEncrypted: true, customerName: true } as const;
const sellerSelect = { name: true, email: true, ownerUserId: true } as const;

/**
 * Worker handler for "fulfilment.notice": tells the other side about an
 * order step, a booking change or a new message, by email, SMS (for the
 * steps that matter on the day) and in-app.
 */
export async function sendFulfilmentNotice(n: FulfilmentNotice): Promise<void> {
  await withSystemContext(async (tx) => {
    if (n.type === "order.status") {
      const so = await tx.sellerOrder.findUnique({ where: { id: n.sellerOrderId }, include: { order: { select: customerSelect }, business: { select: sellerSelect } } });
      if (!so || so.status !== n.status) return;
      const shop = so.business.name;
      const copy: Partial<Record<string, { lines: string[]; sms: string | null }>> = {
        processing: { lines: [`${shop} is preparing your items.`], sms: null },
        shipped: {
          lines: [`${shop} has sent your items.`, ...(so.trackingNumber ? [`Tracking: ${so.carrier ? `${so.carrier} ` : ""}${so.trackingNumber}`] : [])],
          sms: `${shop} has sent order ${so.orderNumber}${so.trackingNumber ? ` (tracking ${so.trackingNumber})` : ""}.`,
        },
        ready_for_pickup: { lines: [`Your items from ${shop} are ready to collect.`], sms: `Order ${so.orderNumber} from ${shop} is ready for pickup.` },
        delivered: { lines: [`${shop} marked your items as delivered. If they haven't arrived or something's wrong, tell us from your order page.`], sms: null },
        cancelled: { lines: [`${shop} cancelled their part of your order.`], sms: `${shop} cancelled their part of order ${so.orderNumber}.` },
      };
      const c = copy[so.status];
      if (!c) return;
      await tellCustomer(tx, so.order, { type: `order.${so.status}`, title: `${ORDER_STATUS_LABELS[so.status]}: ${shop}`, ...c });
      return;
    }

    if (n.type === "booking.status") {
      const b = await tx.booking.findUnique({
        where: { id: n.bookingId },
        include: { service: { select: { title: true } }, sellerOrder: { select: { id: true, order: { select: customerSelect } } }, business: { select: sellerSelect } },
      });
      // A move is notified once the booking has its new time (status is then requested or confirmed again).
      if (!b || (n.status !== "rescheduled" && b.status !== n.status)) return;
      const when = formatBookingTime(b.startsAt);
      const what = `${b.service.title} on ${when}`;
      const status = n.status as keyof typeof BOOKING_STATUS_LABELS;
      const title = `${BOOKING_STATUS_LABELS[status]}: ${b.service.title}`;
      const before = b.previousStartsAt ? formatBookingTime(b.previousStartsAt) : null;
      if (n.by === "customer") {
        await tellSeller(tx, b.business, {
          type: `booking.${status}`,
          title,
          lines: [status === "rescheduled" ? `The customer moved ${b.service.title}${before ? ` from ${before}` : ""} to ${when}.` : `The customer cancelled ${what}.`],
          path: `/dashboard/orders/${b.sellerOrder.id}`,
        });
        return;
      }
      const lines: Record<string, string> = {
        confirmed: `${b.business.name} confirmed your booking: ${what}.`,
        cancelled: `${b.business.name} cancelled your booking for ${what}.${b.cancelReason ? ` Reason: ${b.cancelReason}` : ""}`,
        rescheduled: `${b.business.name} moved your booking for ${b.service.title}${before ? ` from ${before}` : ""} to ${when}.`,
        completed: `${b.business.name} marked ${b.service.title} as done. We'd love a review.`,
        no_show: `${b.business.name} marked ${what} as missed.`,
      };
      const line = lines[status];
      if (!line) return;
      const sms = ["confirmed", "cancelled", "rescheduled"].includes(status) ? line : null;
      await tellCustomer(tx, b.sellerOrder.order, { type: `booking.${status}`, title, lines: [line], sms });
      return;
    }

    const m = await tx.message.findUnique({ where: { id: n.messageId }, include: { sellerOrder: { select: { id: true, orderNumber: true, order: { select: customerSelect }, business: { select: sellerSelect } } } } });
    if (!m || m.readAt) return;
    const preview = m.body.length > 140 ? `${m.body.slice(0, 140)}…` : m.body;
    if (m.sender === "customer") {
      await tellSeller(tx, m.sellerOrder.business, { type: "message.new", title: `New message about ${m.sellerOrder.orderNumber}`, lines: [`${m.sellerOrder.order.customerName}: “${preview}”`], path: `/dashboard/orders/${m.sellerOrder.id}#messages` });
    } else {
      await tellCustomer(tx, m.sellerOrder.order, { type: "message.new", title: `${m.sellerOrder.business.name} sent you a message`, lines: [`“${preview}”`], sms: null });
    }
  });
}

/**
 * A booking reminder to both sides (email, SMS and in-app for the customer;
 * email and in-app for the seller). Called by the reminder job in the system
 * scope, inside the transaction that marked the reminder sent.
 */
export async function sendBookingReminder(tx: Tx, bookingId: string, which: "day" | "hour"): Promise<void> {
  const b = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { service: { select: { title: true } }, sellerOrder: { select: { id: true, order: { select: customerSelect } } }, business: { select: { ...sellerSelect, phoneEncrypted: true } } },
  });
  const when = formatBookingTime(b.startsAt);
  // dateToLagosLocal gives "YYYY-MM-DDTHH:mm"; the day-before reminder may land on the same day for an evening booking.
  const today = dateToLagosLocal(new Date()).slice(0, 10) === dateToLagosLocal(b.startsAt).slice(0, 10);
  const soon = which === "hour" ? "in about an hour" : today ? "later today" : "tomorrow";
  const loc = b.locationSnapshot as { kind: "customer" | "provider"; lgaName?: string } | null;
  const where = loc?.kind === "customer" ? "The provider comes to your address." : "It's at the provider's place; the address is on your order page.";
  const balance = b.balanceKobo > 0n ? [`Remember to pay ${formatPrice(b.balanceKobo)} to ${b.business.name} on the day.`] : [];
  await tellCustomer(tx, b.sellerOrder.order, {
    type: `booking.reminder_${which}`,
    title: `Reminder: ${b.service.title} ${soon}`,
    lines: [`Your booking with ${b.business.name} is ${soon}: ${when}.`, where, ...balance],
    sms: `Reminder: ${b.service.title} with ${b.business.name} ${soon}, ${when}. Provider: ${decrypt(b.business.phoneEncrypted)}`,
  });
  await tellSeller(tx, b.business, {
    type: `booking.reminder_${which}`,
    title: `Coming up ${soon}: ${b.service.title}`,
    lines: [`${b.sellerOrder.order.customerName} is booked for ${when} (${b.sellerOrder.order.orderNumber}).`],
    path: `/dashboard/orders/${b.sellerOrder.id}`,
  });
}
