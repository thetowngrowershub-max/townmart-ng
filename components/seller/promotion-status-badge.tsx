import { Badge } from "@/components/ui/badge";
import type { PromotionStatus } from "@/lib/promotions/promotions";

const LABEL: Record<PromotionStatus, string> = { live: "Live", scheduled: "Scheduled", paused: "Paused", ended: "Ended", used_up: "Used up" };
const VARIANT = { live: "success", scheduled: "info", paused: "warning", ended: "secondary", used_up: "secondary" } as const;

export function PromotionStatusBadge({ status }: { status: PromotionStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
