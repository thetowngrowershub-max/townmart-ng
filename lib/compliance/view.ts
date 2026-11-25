import type { DsrStatus } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { getCompanyDetails } from "@/lib/legal/company";
import { LEGAL_SLUGS } from "@/lib/legal/documents";
import { OPEN_STATUSES } from "@/lib/privacy/requests";
import { ndpcClock } from "./breach";

/** Audit actions that record staff opening someone's personal data. */
export const ACCESS_ACTIONS = ["personal_data.viewed", "business.application_viewed", "kyc.document_viewed"];

export async function complianceOverview(tx: Tx, now = new Date()) {
  const week = new Date(now.getTime() + 7 * 86_400_000);
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [open, overdue, dueSoon, unverified, breaches, consent, company, templates] = await Promise.all([
    tx.dataSubjectRequest.count({ where: { status: { in: OPEN_STATUSES } } }),
    tx.dataSubjectRequest.count({ where: { status: { in: OPEN_STATUSES }, dueAt: { lt: now } } }),
    tx.dataSubjectRequest.count({ where: { status: { in: OPEN_STATUSES }, dueAt: { gte: now, lt: week } } }),
    tx.dataSubjectRequest.count({ where: { status: "unverified" } }),
    tx.breachIncident.findMany({ where: { status: { not: "closed" } }, orderBy: { awareAt: "asc" } }),
    tx.$queryRaw<{ choice: string; n: bigint }[]>`
      SELECT CASE WHEN functional AND analytics AND marketing THEN 'all'
                  WHEN NOT (functional OR analytics OR marketing) THEN 'none'
                  ELSE 'some' END AS choice, count(*) AS n
        FROM consent_records WHERE created_at >= ${since} GROUP BY 1`,
    getCompanyDetails(tx),
    tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM (
        SELECT DISTINCT ON (slug) slug, is_template FROM legal_documents
         WHERE effective_at <= ${now} ORDER BY slug, effective_at DESC, created_at DESC) d
       WHERE is_template`,
  ]);
  const consentCounts = Object.fromEntries(consent.map((c) => [c.choice, Number(c.n)])) as Partial<Record<"all" | "none" | "some", number>>;
  return {
    requests: { open, overdue, dueSoon, unverified },
    breaches: breaches.map((b) => ({ id: b.id, reference: b.reference, title: b.title, risk: b.risk, status: b.status, clock: ndpcClock(b, now) })),
    consent: { all: consentCounts.all ?? 0, none: consentCounts.none ?? 0, some: consentCounts.some ?? 0 },
    companyMissing: Object.values(company).filter((v) => v === null).length,
    templatePages: Number(templates[0]?.n ?? 0),
  };
}

export type RequestFilter = "open" | "unverified" | "closed" | "all";

export async function listDataRequests(tx: Tx, filter: RequestFilter) {
  const status: DsrStatus[] | undefined =
    filter === "open" ? OPEN_STATUSES : filter === "unverified" ? ["unverified"] : filter === "closed" ? ["completed", "rejected", "cancelled"] : undefined;
  return tx.dataSubjectRequest.findMany({
    where: status ? { status: { in: status } } : {},
    orderBy: filter === "open" ? [{ dueAt: "asc" }] : [{ createdAt: "desc" }],
    take: 200,
    select: { id: true, reference: true, type: true, status: true, name: true, email: true, channel: true, dueAt: true, createdAt: true, completedAt: true },
  });
}

export async function loadDataRequest(tx: Tx, id: string) {
  const r = await tx.dataSubjectRequest.findUnique({ where: { id } });
  if (!r) return null;
  const [account, history] = await Promise.all([
    tx.user.findUnique({
      where: r.userId ? { id: r.userId } : { email: r.email },
      select: { id: true, email: true, name: true, status: true, createdAt: true, deletionRequestedAt: true, _count: { select: { orders: true, ownedBusinesses: true } } },
    }),
    tx.auditLog.findMany({ where: { entityType: "data_subject_request", entityId: id, action: { startsWith: "dsr." } }, orderBy: { createdAt: "asc" }, select: { action: true, createdAt: true, after: true } }),
  ]);
  return { request: r, account, linked: r.userId !== null, history };
}

export async function consentLog(tx: Tx) {
  return tx.consentRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, subjectId: true, userId: true, functional: true, analytics: true, marketing: true, policyVersion: true, source: true, createdAt: true, user: { select: { email: true } } },
  });
}

export async function accessLog(tx: Tx) {
  const rows = await tx.auditLog.findMany({ where: { action: { in: ACCESS_ACTIONS } }, orderBy: { createdAt: "desc" }, take: 100 });
  const ids = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => v !== null))];
  const actors = new Map((await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  return rows.map((r) => ({ ...r, actorEmail: r.actorUserId ? (actors.get(r.actorUserId) ?? "Unknown") : "System" }));
}

export async function legalOverview(tx: Tx, now = new Date()) {
  const docs = await tx.legalDocument.findMany({ orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }], select: { id: true, slug: true, version: true, title: true, effectiveAt: true, isTemplate: true } });
  return LEGAL_SLUGS.map((slug) => {
    const versions = docs.filter((d) => d.slug === slug);
    const current = versions.find((d) => d.effectiveAt <= now) ?? null;
    const upcoming = versions.filter((d) => d.effectiveAt > now).at(-1) ?? null;
    return { slug, current, upcoming, versions: versions.length };
  });
}
