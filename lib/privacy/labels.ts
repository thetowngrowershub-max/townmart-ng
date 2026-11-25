import type { DsrStatus, DsrType } from "@prisma/client";

export const DSR_TYPE_LABELS: Record<DsrType, string> = {
  access: "Copy of my data",
  portability: "Data in a machine-readable file",
  rectification: "Correct my data",
  erasure: "Delete my account",
  restriction: "Restrict processing",
  objection: "Object to processing",
  withdraw_consent: "Withdraw consent",
  other: "Something else",
};

export const DSR_STATUS_LABELS: Record<DsrStatus, string> = {
  unverified: "Email not confirmed",
  open: "Received",
  in_progress: "In progress",
  completed: "Completed",
  rejected: "Declined",
  cancelled: "Cancelled",
};
