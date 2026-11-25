import type { OrderStatus } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { formatDateTime, formatTime } from "@/lib/datetime";
import type { Tx } from "@/lib/db";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";

/**
 * The admin's delivery board: every delivery that's on the go, where it's
 * stuck, and a running log of what happened. Admin RLS scope.
 */

export type DeliveryStage = "needs_rider" | "assigned" | "on_the_way" | "delivered";
export const STAGE_LABELS: Record<DeliveryStage, string> = {
  needs_rider: "Needs a rider",
  assigned: "Rider assigned",
  on_the_way: "On the way",
  delivered: "Delivered (24h)",
};

/** When a delivery counts as late at each stage. Kept simple and in one place. */
export const LATE_AFTER_MS: Record<Exclude<DeliveryStage, "delivered">, number> = {
  needs_rider: 2 * 3600_000,
  assigned: 2 * 3600_000,
  on_the_way: 4 * 3600_000,
};

export type DeliveryRow = {
  sellerOrderId: string;
  orderNumber: string;
  shop: string;
  area: string;
  stage: DeliveryStage;
  status: string;
  rider: { name: string; phone: string; seen: string | null; mapUrl: string | null; townmart: boolean } | null;
  /** Offered to the TownMart rider pool (waiting for a rider to take it, while there's none). */
  pooled: boolean;
  /** TownMart can still put a pool rider on it (no pickup yet). */
  canAssignPool: boolean;
  payOnDelivery: boolean;
  /** Since the stage began, for the board's "waiting" column. */
  since: Date;
  late: boolean;
  times: { label: string; at: string }[];
};

export type ActivityRow = { id: string; at: string; orderNumber: string; sellerOrderId: string; shop: string; text: string };

export function stageOf(so: { status: OrderStatus; riderId: string | null; pickedUpAt: Date | null }): DeliveryStage {
  if (so.status === "delivered" || so.status === "completed") return "delivered";
  if (!so.riderId) return so.status === "shipped" ? "on_the_way" : "needs_rider";
  return so.pickedUpAt || so.status === "shipped" ? "on_the_way" : "assigned";
}

/** When the current stage started: paid, assigned, picked up (or sent), delivered. */
function stageSince(stage: DeliveryStage, so: { createdAt: Date; riderAssignedAt: Date | null; pickedUpAt: Date | null; shippedAt: Date | null; deliveredAt: Date | null; paidAt: Date | null }): Date {
  switch (stage) {
    case "needs_rider":
      return so.paidAt ?? so.createdAt;
    case "assigned":
      return so.riderAssignedAt ?? so.createdAt;
    case "on_the_way":
      return so.pickedUpAt ?? so.shippedAt ?? so.createdAt;
    case "delivered":
      return so.deliveredAt ?? so.createdAt;
  }
}

export async function deliveryBoard(tx: Tx, now = new Date()): Promise<{ rows: DeliveryRow[]; counts: Record<DeliveryStage | "late", number> }> {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const list = await tx.sellerOrder.findMany({
    where: {
      deliveryMethod: "delivery",
      OR: [{ status: { in: ["paid", "processing", "shipped"] } }, { status: { in: ["delivered", "completed"] }, deliveredAt: { gte: dayAgo } }],
    },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      payOnDelivery: true,
      fulfilmentContact: true,
      riderId: true,
      riderAssignedAt: true,
      riderPoolOpenedAt: true,
      pickedUpAt: true,
      shippedAt: true,
      deliveredAt: true,
      createdAt: true,
      business: { select: { name: true } },
      rider: { select: { name: true, phoneEncrypted: true, latitude: true, longitude: true, locationUpdatedAt: true, businessId: true } },
      order: { select: { paidAt: true } },
    },
  });

  const counts = { needs_rider: 0, assigned: 0, on_the_way: 0, delivered: 0, late: 0 };
  const rows = list.map((so): DeliveryRow => {
    const stage = stageOf(so);
    const since = stageSince(stage, { ...so, paidAt: so.order.paidAt });
    const late = stage !== "delivered" && now.getTime() - since.getTime() > LATE_AFTER_MS[stage];
    counts[stage] += 1;
    if (late) counts.late += 1;
    const a = (so.fulfilmentContact as { address?: { city: string; lgaName: string } | null } | null)?.address;
    const r = so.rider;
    return {
      sellerOrderId: so.id,
      orderNumber: so.orderNumber,
      shop: so.business.name,
      area: a ? `${a.city}, ${a.lgaName}` : "",
      stage,
      status: ORDER_STATUS_LABELS[so.status],
      rider: r
        ? {
            name: r.name,
            phone: decrypt(r.phoneEncrypted),
            seen: r.locationUpdatedAt ? formatTime(r.locationUpdatedAt) : null,
            mapUrl: r.latitude !== null && r.longitude !== null ? `https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}` : null,
            townmart: r.businessId === null,
          }
        : null,
      pooled: so.riderPoolOpenedAt !== null,
      canAssignPool: !so.pickedUpAt && (so.status === "paid" || so.status === "processing"),
      payOnDelivery: so.payOnDelivery,
      since,
      late,
      times: [
        { label: "Paid", at: so.order.paidAt ?? so.createdAt },
        { label: "Rider", at: so.riderAssignedAt },
        { label: "Picked up", at: so.pickedUpAt ?? so.shippedAt },
        { label: "Delivered", at: so.deliveredAt },
      ].flatMap((t) => (t.at ? [{ label: t.label, at: formatTime(t.at) }] : [])),
    };
  });
  // Late first, then the longest waiting.
  rows.sort((x, y) => Number(y.late) - Number(x.late) || x.since.getTime() - y.since.getTime());
  return { rows, counts };
}

/** What happened on delivery orders lately, newest first: placed, preparing, rider changes, picked up, delivered. */
export async function deliveryActivity(tx: Tx, take = 40): Promise<ActivityRow[]> {
  const rows = await tx.orderStatusHistory.findMany({
    where: { sellerOrder: { deliveryMethod: "delivery" } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, createdAt: true, fromStatus: true, toStatus: true, note: true, sellerOrder: { select: { id: true, orderNumber: true, business: { select: { name: true } } } } },
  });
  return rows.map((h) => ({
    id: h.id,
    at: formatDateTime(h.createdAt),
    orderNumber: h.sellerOrder.orderNumber,
    sellerOrderId: h.sellerOrder.id,
    shop: h.sellerOrder.business.name,
    text: h.note ?? (h.fromStatus === h.toStatus ? ORDER_STATUS_LABELS[h.toStatus] : `${h.fromStatus ? `${ORDER_STATUS_LABELS[h.fromStatus]} → ` : ""}${ORDER_STATUS_LABELS[h.toStatus]}`),
  }));
}
