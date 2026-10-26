export const IMPORT_STATUS = {
  queued: { label: "Queued", variant: "secondary" },
  processing: { label: "Processing", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
} as const;
