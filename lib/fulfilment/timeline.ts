import type { BookingStatus, OrderStatus } from "@prisma/client";
import { BOOKING_STATUS_LABELS } from "@/lib/bookings/status";
import { formatDateTime } from "@/lib/datetime";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";

type OrderEvent = { toStatus: OrderStatus; note: string | null; createdAt: Date };
type BookingEvent = { toStatus: BookingStatus; note: string | null; createdAt: Date };

/** Order and booking history in one list, oldest first. Used on both the seller's and the customer's order pages. */
export function mergeTimeline(order: OrderEvent[], items: { snapshot: unknown; booking: { statusHistory: BookingEvent[] } | null }[]): { label: string; note: string | null; at: string }[] {
  const events = [
    ...order.map((h) => ({ at: h.createdAt, label: ORDER_STATUS_LABELS[h.toStatus], note: h.note })),
    ...items.flatMap((i) =>
      (i.booking?.statusHistory ?? []).map((h) => ({ at: h.createdAt, label: `${(i.snapshot as { title: string }).title}: ${BOOKING_STATUS_LABELS[h.toStatus].toLowerCase()}`, note: h.note })),
    ),
  ];
  return events.sort((a, b) => a.at.getTime() - b.at.getTime()).map((e) => ({ label: e.label, note: e.note, at: formatDateTime(e.at) }));
}
