import type { RefundStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

const VARIANT: Record<RefundStatus, "default" | "secondary" | "success" | "warning" | "danger" | "info"> = {
  requested: "warning",
  approved: "info",
  processing: "info",
  completed: "success",
  rejected: "secondary",
  failed: "danger",
};

export function RefundStatusBadge({ status, label }: { status: RefundStatus; label: string }) {
  return <Badge variant={VARIANT[status]}>{label}</Badge>;
}
