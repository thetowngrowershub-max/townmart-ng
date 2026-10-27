import type { Tx } from "@/lib/db";

/**
 * How long TownMart keeps each kind of data, in days. Admins change these in
 * the compliance centre (`retention_settings`); a missing row falls back to
 * the default here, so the jobs never run without a period.
 */
export const RETENTION_DEFAULTS = {
  abandoned_carts: { days: 30, label: "Abandoned carts", description: "Carts not touched for this long are deleted." },
  unverified_accounts: { days: 30, label: "Unconfirmed accounts", description: "Accounts whose email was never confirmed, with no orders or shop, are deleted." },
  logs: { days: 365, label: "Logs and in-app notifications", description: "Background job logs and in-app notifications older than this are deleted. The audit log is kept separately as an accountability record." },
  deletion_grace: { days: 14, label: "Account deletion grace period", description: "How long someone has to change their mind before a deleted account is anonymised." },
  export_link: { days: 7, label: "Data export download link", description: "How long a data export stays downloadable before the files are deleted." },
  dsr_response: { days: 30, label: "Data request deadline", description: "The time TownMart gives itself to answer a data subject request." },
  unverified_requests: { days: 7, label: "Unconfirmed data requests", description: "Public data requests whose email was never confirmed are deleted after this long." },
  seller_contact: { days: 30, label: "Customer phone shown to sellers", description: "Days after an order is completed that the seller can still see the customer's phone number." },
} as const;

export type RetentionKey = keyof typeof RETENTION_DEFAULTS;
export type RetentionPeriods = Record<RetentionKey, number>;
export const RETENTION_KEYS = Object.keys(RETENTION_DEFAULTS) as RetentionKey[];

export async function getRetention(tx: Tx): Promise<RetentionPeriods> {
  const rows = await tx.retentionSetting.findMany({ select: { key: true, days: true } });
  const saved = new Map(rows.map((r) => [r.key, r.days]));
  return Object.fromEntries(RETENTION_KEYS.map((k) => [k, saved.get(k) ?? RETENTION_DEFAULTS[k].days])) as RetentionPeriods;
}

export const daysAgo = (days: number, now = new Date()) => new Date(now.getTime() - days * 86_400_000);
export const daysFrom = (days: number, from = new Date()) => new Date(from.getTime() + days * 86_400_000);
