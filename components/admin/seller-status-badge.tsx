import type { BusinessStatus, KycStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

const BUSINESS: Record<BusinessStatus, { label: string; variant: "secondary" | "warning" | "info" | "success" | "danger" }> = {
  draft: { label: "Draft", variant: "secondary" },
  pending: { label: "Pending", variant: "warning" },
  under_review: { label: "Under review", variant: "info" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  suspended: { label: "Suspended", variant: "danger" },
};

const KYC: Record<KycStatus, { label: string; variant: "secondary" | "warning" | "success" | "danger" }> = {
  not_submitted: { label: "ID not sent", variant: "secondary" },
  pending: { label: "ID to check", variant: "warning" },
  verified: { label: "ID verified", variant: "success" },
  failed: { label: "ID failed", variant: "danger" },
};

export function BusinessStatusBadge({ status }: { status: BusinessStatus }) {
  const s = BUSINESS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function KycStatusBadge({ status }: { status: KycStatus }) {
  const s = KYC[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
