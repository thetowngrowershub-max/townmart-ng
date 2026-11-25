import type { Tx } from "@/lib/db";

/**
 * Company details quoted in the legal pages ({{company.*}} placeholders).
 * Kept in `settings` so they can be filled in from the compliance centre
 * without republishing every page.
 */
export const COMPANY_FIELDS = {
  legal_name: "Registered company name",
  rc_number: "CAC RC number",
  address: "Registered address",
  support_email: "Support email",
  support_phone: "Support phone",
  dpo_name: "Data Protection Officer",
  dpo_email: "DPO email",
  hosting_location: "Where the database is hosted",
} as const;

export type CompanyField = keyof typeof COMPANY_FIELDS;
export const COMPANY_KEYS = Object.keys(COMPANY_FIELDS) as CompanyField[];
export type CompanyDetails = Record<CompanyField, string | null>;

export async function getCompanyDetails(tx: Tx): Promise<CompanyDetails> {
  const rows = await tx.setting.findMany({ where: { key: { in: COMPANY_KEYS.map((k) => `company.${k}`) } } });
  const v = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    COMPANY_KEYS.map((k) => {
      const value = v.get(`company.${k}`);
      return [k, typeof value === "string" && value.trim() ? value.trim() : null];
    }),
  ) as CompanyDetails;
}
