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
import { sendMoneyNotice } from "@/lib/refunds/notify";
import { formatDistance } from "@/lib/geo/distance";
import { OPEN_JOB_STATUSES, poolCandidates, riderPay } from "@/lib/riders/pool";
import { getCheckoutSettings } from "@/lib/settings";
import { deliveryCode, riderJobUrl } from "./rider-job";

export type Customer = { id: string; orderNumber: string; isGuest: boolean; userId: string | null; contactEmail: string; contactPhoneEncrypted: string; customerName: string };
export type Seller = { name: string; email: string; ownerUserId: string };

/** One in-app notification, written once even if the job is retried. */
async function inApp(tx: Tx, n: { userId: string; type: string; title: string; body: string; link: string }) {
  const exists = await tx.notification.findFirst({ where: { userId: n.userId, type: n.type, title: n.title, link: n.link }, select: { id: true } });
  if (!exists) await tx.notification.create({ data: n });
}

/** The customer's way back to their order: their account page, or the guest link. */
const customerLink = (o: Customer) => ({ url: orderUrl(o), path: `/account/orders/${o.orderNumber}` });

/**
 * Email, SMS and in-app, within the customer's notification settings: the
 * optional channels (texts, emails about messages) can be switched off;
 * guests get the defaults.
 */
export async function tellCustomer(tx: Tx, o: Customer, p: { type: string; title: string; lines: string[]; sms: string | null; link?: { url: string; path: string }; buttonLabel?: string }) {
  const link = p.link ?? customerLink(o);
  const prefs = o.userId ? await tx.notificationPreference.findUnique({ where: { userId: o.userId } }) : null;
  const emailOk = p.type !== "message.new" || (prefs?.emailMessages ?? true);
  const smsOk = p.type.startsWith("booking.reminder") ? (prefs?.smsBookingReminders ?? true) : (prefs?.smsOrderUpdates ?? true);
  if (emailOk) {
    await enqueueEmail(noticeTemplate({ to: o.contactEmail, subject: `${p.title} · ${o.orderNumber}`, title: p.title, lines: [`Hi ${o.customerName},`, ...p.lines], url: link.url, buttonLabel: p.buttonLabel ?? "View your order" }));
  }
  if (p.sms && smsOk) await enqueueSms({ to: decrypt(o.contactPhoneEncrypted), body: `TownMart: ${p.sms}` });
  if (o.userId) await inApp(tx, { userId: o.userId, type: p.type, title: p.title, body: p.lines[0] ?? "", link: link.path });
}

export async function tellSeller(tx: Tx, s: Seller, p: { type: string; title: string; lines: string[]; path: string }) {
  await enqueueEmail(noticeTemplate({ to: s.email, subject: p.title, title: p.title, lines: p.lines, url: `${env().APP_URL}${p.path}`, buttonLabel: "Open in your dashboard" }));
  await inApp(tx, { userId: s.ownerUserId, type: p.type, title: p.title, body: p.lines[0] ?? "", link: p.path });
}

export const customerSelect = { id: true, orderNumber: true, isGuest: true, userId: true, contactEmail: true, contactPhoneEncrypted: true, customerName: true } as const;
export const sellerSelect = { name: true, email: true, ownerUserId: true } as const;

/**
 * Worker handler for "fulfilment.notice": tells the other side about an
 * order step, a booking change or a new message, by email, SMS (for the
 * steps that matter on the day) and in-app.
 */
export async function sendFulfilmentNotice(n: FulfilmentNotice): Promise<void> {
  if (n.type === "refund.update" || n.type === "dispute.update" || n.type === "payout.update") return sendMoneyNotice(n);
  await withSystemContext(async (tx) => {
    if (n.type === "rider.assigned") return sendRiderAssigned(tx, n.sellerOrderId, n.at);
    if (n.type === "rider.pool_offer") return sendPoolOffer(tx, n.sellerOrderId, n.at);

    if (n.type === "order.status") {
      const so = await tx.sellerOrder.findUnique({ where: { id: n.sellerOrderId }, include: { order: { select: customerSelect }, business: { select: sellerSelect }, rider: { select: { name: true, phoneEncrypted: true } } } });
      if (!so || so.status !== n.status) return;
      const shop = so.business.name;
      const rider = so.rider && so.pickedUpAt ? so.rider : null;
      if (rider && (so.status === "shipped" || so.status === "delivered")) {
        // The shop's own rider: name, number and the code, so the customer knows who's coming.
        const code = deliveryCode(so);
        if (so.status === "shipped") {
          await tellCustomer(tx, so.order, {
            type: "order.shipped",
            title: `On its way: ${shop}`,
            lines: [`${rider.name} has picked up your items from ${shop} and is on the way.`, `Rider's phone: ${decrypt(rider.phoneEncrypted)}`, `Give the rider this code when your items arrive: ${code}`],
            sms: `${rider.name} (${decrypt(rider.phoneEncrypted)}) is on the way with order ${so.orderNumber}. Delivery code: ${code}`,
          });
        } else {
          await tellCustomer(tx, so.order, { type: "order.delivered", title: `Delivered: ${shop}`, lines: [`${rider.name} delivered your items from ${shop}. If something's wrong, tell us from your order page.`], sms: null });
          await tellSeller(tx, so.business, { type: "order.delivered", title: `Delivered: ${so.orderNumber}`, lines: [`${rider.name} delivered order ${so.orderNumber} and the customer's code matched.`], path: `/dashboard/orders/${so.id}` });
        }
        return;
      }
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
        completed: `${b.business.name} marked ${b.service.title} as done. How did they do? Rate their service to help your neighbours choose.`,
        no_show: `${b.business.name} marked ${what} as missed.`,
      };
      const line = lines[status];
      if (!line) return;
      const sms = ["confirmed", "cancelled", "rescheduled"].includes(status) ? line : null;
      // A done booking asks a signed-in customer to rate the provider, straight to the form.
      const rate = status === "completed" && b.sellerOrder.order.userId ? { path: `/account/reviews/new?item=${b.orderItemId}` } : null;
      await tellCustomer(tx, b.sellerOrder.order, {
        type: `booking.${status}`,
        title,
        lines: [line],
        sms,
        ...(rate ? { link: { url: `${env().APP_URL}${rate.path}`, path: rate.path }, buttonLabel: "Rate my service" } : {}),
      });
      return;
    }

    const m = await tx.message.findUnique({ where: { id: n.messageId }, include: { sellerOrder: { select: { id: true, orderNumber: true, order: { select: customerSelect }, business: { select: sellerSelect } } } } });
    if (!m || m.readAt) return;
    const preview = m.body.length > 140 ? `${m.body.slice(0, 140)}…` : m.body;
    const sellerPath = `/dashboard/orders/${m.sellerOrder.id}#messages`;
    if (m.sender === "rider") {
      const who = m.senderName ?? "Your rider";
      await tellSeller(tx, m.sellerOrder.business, { type: "message.new", title: `Rider message about ${m.sellerOrder.orderNumber}`, lines: [`${who} (rider): “${preview}”`], path: sellerPath });
      // Riders write when it matters on the day ("I'm at the gate"), so the customer gets a text too.
      await tellCustomer(tx, m.sellerOrder.order, { type: "message.new", title: `${who} (your rider) sent a message`, lines: [`“${preview}”`], sms: `Rider ${who}: ${m.body.length > 90 ? `${m.body.slice(0, 90)}…` : m.body}` });
      return;
    }
    if (m.sender === "customer") {
      await tellSeller(tx, m.sellerOrder.business, { type: "message.new", title: `New message about ${m.sellerOrder.orderNumber}`, lines: [`${m.sellerOrder.order.customerName}: “${preview}”`], path: sellerPath });
    } else {
      await tellCustomer(tx, m.sellerOrder.order, { type: "message.new", title: `${m.sellerOrder.business.name} sent you a message`, lines: [`“${preview}”`], sms: null });
    }
    await textRiderAboutMessage(tx, m.sellerOrder.id, m.sender === "customer" ? m.sellerOrder.order.customerName : m.sellerOrder.business.name, m.body);
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

/** Where the rider is going, in a few words for a text: landmark or city, then the LGA. */
function dropOffArea(contact: unknown): string {
  const a = (contact as { address?: { landmark: string | null; city: string; lgaName: string } | null } | null)?.address;
  if (!a) return "the customer";
  return [a.landmark ? `near ${a.landmark}` : a.city, a.lgaName].filter(Boolean).join(", ").slice(0, 50);
}

/**
 * A delivery went to the TownMart rider pool: the nearest online riders get a
 * text pointing at their jobs page, where the first to tap "Take this job"
 * gets it. Only where the job and the area go, never the customer's details.
 * Skipped if the job has been taken or reopened since (a newer notice covers it).
 */
async function sendPoolOffer(tx: Tx, sellerOrderId: string, at: number): Promise<void> {
  const so = await tx.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    select: { riderId: true, riderPoolOpenedAt: true, status: true, deliveryKobo: true, deliveryDistanceM: true, fulfilmentContact: true, business: { select: { name: true, latitude: true, longitude: true } } },
  });
  if (!so || so.riderId || so.riderPoolOpenedAt?.getTime() !== at || !(OPEN_JOB_STATUSES as readonly string[]).includes(so.status)) return;
  const settings = await getCheckoutSettings(tx);
  if (settings.riderPoolOfferCount === 0) return;
  const shop = so.business.latitude !== null && so.business.longitude !== null ? { lat: so.business.latitude, lng: so.business.longitude } : null;
  const riders = (await poolCandidates(tx, shop, settings.riderPoolMaxJobs)).slice(0, settings.riderPoolOfferCount);
  const pay = formatPrice(riderPay(so.deliveryKobo, settings.riderPoolSharePercent));
  const km = so.deliveryDistanceM !== null ? ` (${formatDistance(so.deliveryDistanceM)})` : "";
  for (const r of riders) {
    await enqueueSms({ to: decrypt(r.phoneEncrypted), body: `TownMart job: ${so.business.name.slice(0, 30)} to ${dropOffArea(so.fulfilmentContact)}${km}. You earn ${pay}. First to take it gets it: ${env().APP_URL}/rider` });
  }
}

/**
 * A rider was put on a delivery: the rider gets one text with their job
 * link, the customer gets the rider's name and number and the delivery code.
 * Skipped if the rider has since been changed (a newer notice covers it).
 */
async function sendRiderAssigned(tx: Tx, sellerOrderId: string, at: number): Promise<void> {
  const so = await tx.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    include: { order: { select: customerSelect }, business: { select: sellerSelect }, rider: { select: { name: true, phoneEncrypted: true } } },
  });
  if (!so?.rider || so.riderAssignedAt?.getTime() !== at || !["paid", "processing", "shipped"].includes(so.status)) return;
  const url = riderJobUrl(so)!;
  const collect = so.payOnDelivery ? " Pay on delivery." : "";
  await enqueueSms({ to: decrypt(so.rider.phoneEncrypted), body: `TownMart job from ${so.business.name}: order ${so.orderNumber} to ${dropOffArea(so.fulfilmentContact)}.${collect} Open: ${url}` });
  const phone = decrypt(so.rider.phoneEncrypted);
  const code = deliveryCode(so);
  await tellCustomer(tx, so.order, {
    type: "order.rider",
    title: `Rider assigned: ${so.business.name}`,
    lines: [`${so.rider.name} will deliver your items from ${so.business.name}.`, `Rider's phone: ${phone}`, `When your items arrive, give the rider this code: ${code}. Only share it once you have your items.`],
    sms: `${so.rider.name} (${phone}) will deliver order ${so.orderNumber} from ${so.business.name}. Give them code ${code} on arrival.`,
  });
}

/** The customer or shop wrote while a rider is on the delivery: the rider has no inbox, so they get a short text. */
async function textRiderAboutMessage(tx: Tx, sellerOrderId: string, from: string, body: string): Promise<void> {
  const so = await tx.sellerOrder.findUnique({ where: { id: sellerOrderId }, include: { rider: { select: { phoneEncrypted: true } } } });
  if (!so?.rider || !["paid", "processing", "shipped"].includes(so.status)) return;
  const text = body.length > 60 ? `${body.slice(0, 60)}…` : body;
  await enqueueSms({ to: decrypt(so.rider.phoneEncrypted), body: `TownMart ${so.orderNumber}, ${from.slice(0, 30)}: ${text} Reply: ${riderJobUrl(so)}` });
}
