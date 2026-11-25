import type { BreachIncident } from "@prisma/client";
import type { CompanyDetails } from "@/lib/legal/company";

/** NDPA 2023 s.40: tell the NDPC within 72 hours of becoming aware of a breach. */
export const NDPC_HOURS = 72;

export type NdpcClock =
  | { state: "notified"; deadline: Date; notifiedAt: Date; onTime: boolean }
  | { state: "running"; deadline: Date; msLeft: number }
  | { state: "overdue"; deadline: Date; msLate: number };

export function ndpcClock(b: Pick<BreachIncident, "awareAt" | "ndpcNotifiedAt">, now = new Date()): NdpcClock {
  const deadline = new Date(b.awareAt.getTime() + NDPC_HOURS * 3600_000);
  if (b.ndpcNotifiedAt) return { state: "notified", deadline, notifiedAt: b.ndpcNotifiedAt, onTime: b.ndpcNotifiedAt <= deadline };
  const ms = deadline.getTime() - now.getTime();
  return ms >= 0 ? { state: "running", deadline, msLeft: ms } : { state: "overdue", deadline, msLate: -ms };
}

/** "41h 05m" */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export const RISK_LABELS = { low: "Low", medium: "Medium", high: "High" } as const;
export const BREACH_STATUS_LABELS = { open: "Open", contained: "Contained", closed: "Closed" } as const;
export const SUBJECT_NOTICE_LABELS = { not_required: "Not required", pending: "To do", sent: "Sent" } as const;

/**
 * A starting point for telling the people affected (NDPA s.40(3)): plain
 * language, what happened, what data, what we've done and what they can do.
 * Staff edit it before sending.
 */
export function breachNoticeTemplate(b: Pick<BreachIncident, "description" | "dataCategories" | "actions" | "awareAt">, company: CompanyDetails): { subject: string; body: string } {
  const dpo = company.dpo_email ?? "[DPO email]";
  return {
    subject: "Important: a security incident affecting your TownMart data",
    body: [
      "Hello,",
      "",
      "We're writing to tell you about a security incident at TownMart that affects some of your personal data.",
      "",
      `What happened: ${b.description}`,
      "",
      `What data was involved: ${b.dataCategories.length ? b.dataCategories.join(", ") : "[list the data]"}.`,
      "",
      `What we've done: ${b.actions ?? "[describe the steps taken to contain it and stop it happening again]"}`,
      "",
      "What you can do: be wary of emails, texts or calls claiming to be from TownMart that ask for passwords, codes or payments. We will never ask for your password or a sign-in code. If you use the same password elsewhere, change it there too.",
      "",
      "We have reported this to the Nigeria Data Protection Commission. If you have questions, or want to know more about how this affects you, contact our Data Protection Officer at " + dpo + ".",
      "",
      "We're sorry this happened.",
      "",
      `${company.legal_name ?? "TownMart"}`,
    ].join("\n"),
  };
}
