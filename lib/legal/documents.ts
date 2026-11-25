import type { AcceptanceContext, LegalDocument } from "@prisma/client";
import { getRetention, RETENTION_KEYS } from "@/lib/compliance/retention";
import type { Tx } from "@/lib/db";
import { getCompanyDetails } from "./company";

/** Every page under /legal/*, in footer order. */
export const LEGAL_SLUGS = [
  "privacy",
  "cookies",
  "terms",
  "refunds",
  "shipping",
  "promotions",
  "seller-agreement",
  "service-provider-terms",
  "prohibited-items",
  "dpa",
  "acceptable-use",
  "accessibility",
  "company",
] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export const isLegalSlug = (s: string): s is LegalSlug => (LEGAL_SLUGS as readonly string[]).includes(s);

/** What each journey asks people to accept. */
export const ACCEPTED_AT: Record<AcceptanceContext, readonly LegalSlug[]> = {
  sign_up: ["terms", "privacy"],
  checkout: ["terms", "refunds"],
  seller_onboarding: ["seller-agreement", "dpa", "prohibited-items"],
};

export type CurrentDocument = Pick<LegalDocument, "id" | "slug" | "version" | "title">;

/** The version in force now: the latest one whose effective date has passed. */
export async function currentDocument(tx: Tx, slug: string, now = new Date()): Promise<LegalDocument | null> {
  return tx.legalDocument.findFirst({ where: { slug, effectiveAt: { lte: now } }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] });
}

export async function currentDocuments(tx: Tx, slugs: readonly string[], now = new Date()): Promise<Map<string, CurrentDocument>> {
  const rows = await tx.legalDocument.findMany({
    where: { slug: { in: [...slugs] }, effectiveAt: { lte: now } },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, slug: true, version: true, title: true },
  });
  const out = new Map<string, CurrentDocument>();
  for (const r of rows) if (!out.has(r.slug)) out.set(r.slug, r);
  return out;
}

export class LegalDocumentMissing extends Error {}

/**
 * Records that someone accepted the current version of each document the
 * journey asks for, and returns the versions so callers can copy them onto the
 * order or business.
 */
export async function recordAcceptances(
  tx: Tx,
  p: { context: AcceptanceContext; userId?: string | null; orderId?: string | null; businessId?: string | null; ipHash?: string | null; userAgent?: string | null; slugs?: readonly LegalSlug[] },
): Promise<Record<string, string>> {
  const slugs = p.slugs ?? ACCEPTED_AT[p.context];
  const docs = await currentDocuments(tx, slugs);
  const missing = slugs.filter((s) => !docs.has(s));
  if (missing.length) throw new LegalDocumentMissing(`No published version of: ${missing.join(", ")}`);
  await tx.policyAcceptance.createMany({
    data: slugs.map((s) => ({
      documentId: docs.get(s)!.id,
      context: p.context,
      userId: p.userId ?? null,
      orderId: p.orderId ?? null,
      businessId: p.businessId ?? null,
      ipHash: p.ipHash ?? null,
      userAgent: p.userAgent?.slice(0, 255) ?? null,
    })),
  });
  return Object.fromEntries(slugs.map((s) => [s, docs.get(s)!.version]));
}

/**
 * The label for a new version: its effective date (Lagos), with a suffix if
 * that date is already taken ("2026-11-14", "2026-11-14-2").
 */
export function nextVersion(existing: readonly string[], effectiveAt: Date): string {
  const base = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(effectiveAt);
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\.([a-z_]+)\s*\}\}/g;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Fills {{company.*}} and {{retention.*}} placeholders. Values not set yet
 * show as a highlighted marker, so a page is never published with a blank.
 */
export function fillPlaceholders(html: string, values: Record<string, string | null>): { html: string; missing: string[] } {
  const missing = new Set<string>();
  const out = html.replace(PLACEHOLDER, (_m, group: string, key: string) => {
    const name = `${group}.${key}`;
    const v = values[name];
    if (v == null) {
      missing.add(name);
      return `<mark>[${escapeHtml(name)} not set]</mark>`;
    }
    return escapeHtml(v);
  });
  return { html: out, missing: [...missing] };
}

export async function placeholderValues(tx: Tx): Promise<Record<string, string | null>> {
  const [company, retention] = await Promise.all([getCompanyDetails(tx), getRetention(tx)]);
  return {
    ...Object.fromEntries(Object.entries(company).map(([k, v]) => [`company.${k}`, v])),
    ...Object.fromEntries(RETENTION_KEYS.map((k) => [`retention.${k}`, String(retention[k])])),
  };
}
