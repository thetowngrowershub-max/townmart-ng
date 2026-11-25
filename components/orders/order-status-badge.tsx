import type { BookingStatus, OrderStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

const ORDER_VARIANT: Partial<Record<OrderStatus, "default" | "secondary" | "warning" | "success" | "danger" | "accent">> = {
  pending_payment: "warning",
  paid: "accent",
  processing: "accent",
  shipped: "default",
  ready_for_pickup: "default",
  delivered: "success",
  completed: "success",
  cancelled: "secondary",
};

const BOOKING_VARIANT: Partial<Record<BookingStatus, "default" | "secondary" | "warning" | "success" | "danger" | "accent">> = {
  held: "warning",
  requested: "warning",
  confirmed: "default",
  in_progress: "accent",
  completed: "success",
  cancelled: "secondary",
  no_show: "danger",
  rescheduled: "secondary",
};

export function OrderStatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  return <Badge variant={ORDER_VARIANT[status] ?? "secondary"}>{label}</Badge>;
}

export function BookingStatusBadge({ status, label }: { status: BookingStatus; label: string }) {
  return <Badge variant={BOOKING_VARIANT[status] ?? "secondary"}>{label}</Badge>;
}
