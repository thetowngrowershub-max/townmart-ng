import type { OrderStatus } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { formatDateTime } from "@/lib/datetime";
import { withSystemContext } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import type { FulfilmentContact } from "@/lib/orders/place";
import { loadConversation, type MessageView } from "./messages";
import { parseRiderJobToken, RIDER_LINK_STATUSES, tokenMatches } from "./rider-job";

export type RiderJobView = {
  sellerOrderId: string;
  orderNumber: string;
  status: OrderStatus;
  riderName: string;
  shop: { name: string; phone: string; lines: string[]; mapUrl: string };
  customer: { name: string; phone: string; lines: string[]; mapUrl: string; approximate: boolean };
  items: { title: string; options: string; qty: string }[];
  /** Pay on delivery: what to collect, when this shop is the whole order; else a note to check with the shop. */
  collect: { amount: string | null } | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  messages: MessageView[];
};

/** Directions in Google Maps by link: no API key, opens the rider's maps app. */
const directions = (dest: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;

/**
 * Everything the rider needs for one delivery, from their job link. The link
 * is checked against the current assignment first; only then is the order
 * read, in the system scope (riders have no account).
 */
export async function loadRiderJob(token: string): Promise<RiderJobView | null> {
  const id = parseRiderJobToken(token);
  if (!id) return null;
  return withSystemContext(async (tx) => {
    const so = await tx.sellerOrder.findUnique({
      where: { id },
      include: {
        rider: { select: { name: true } },
        business: { select: { name: true, phoneEncrypted: true, addressEncrypted: true, city: true, latitude: true, longitude: true, lga: { select: { name: true } }, state: { select: { name: true } } } },
        items: { orderBy: { createdAt: "asc" }, select: { snapshot: true, qty: true } },
        order: { select: { customerName: true, totalKobo: true, _count: { select: { sellerOrders: true } } } },
      },
    });
    if (!so?.rider || so.deliveryMethod !== "delivery" || !tokenMatches(so, token)) return null;
    if (!(RIDER_LINK_STATUSES as readonly string[]).includes(so.status)) return null;

    const b = so.business;
    const shopLines = [decrypt(b.addressEncrypted), `${b.city}, ${b.lga.name}, ${b.state.name}`];
    const contact = so.fulfilmentContact as FulfilmentContact | null;
    const a = contact?.address ?? null;
    const custLines = a
      ? [[decrypt(a.line1Encrypted), a.line2Encrypted ? decrypt(a.line2Encrypted) : null].filter(Boolean).join(", "), a.landmark ? `Near ${a.landmark}` : null, `${a.city}, ${a.lgaName}, ${a.stateName}`].filter((x): x is string => Boolean(x))
      : [];
    const point = contact?.point ?? null;
    // An exact pin (GPS or a saved pin) beats the typed address; the town centre doesn't.
    const exact = point && point.source !== "area";
    const messages = await loadConversation(tx, { sellerOrderId: so.id, viewer: "rider", sellerName: b.name, customerName: so.order.customerName });

    return {
      sellerOrderId: so.id,
      orderNumber: so.orderNumber,
      status: so.status,
      riderName: so.rider.name,
      shop: {
        name: b.name,
        phone: decrypt(b.phoneEncrypted),
        lines: shopLines,
        mapUrl: directions(b.latitude !== null && b.longitude !== null ? `${b.latitude},${b.longitude}` : shopLines.join(", ")),
      },
      customer: {
        name: contact?.name ?? so.order.customerName,
        phone: contact ? decrypt(contact.phoneEncrypted) : "",
        lines: custLines,
        mapUrl: directions(exact ? `${point.lat},${point.lng}` : custLines.join(", ")),
        approximate: !exact,
      },
      items: so.items.map((i) => {
        const s = i.snapshot as { title: string; options?: Record<string, string> };
        return { title: s.title, options: Object.values(s.options ?? {}).join(", "), qty: i.qty.toString() };
      }),
      collect: so.payOnDelivery ? { amount: so.order._count.sellerOrders === 1 ? formatPrice(so.order.totalKobo) : null } : null,
      pickedUpAt: so.pickedUpAt ? formatDateTime(so.pickedUpAt) : null,
      deliveredAt: so.deliveredAt ? formatDateTime(so.deliveredAt) : null,
      messages,
    };
  });
}
