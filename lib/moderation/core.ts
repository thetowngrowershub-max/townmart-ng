import type { Prisma } from "@prisma/client";
import { withSystemContext, type Tx } from "@/lib/db";
import { logger } from "@/lib/logger";
import { DEFAULT_KEYWORDS, KEYWORDS_SETTING, matchKeywords } from "./keywords";

export type ListingKind = "product" | "service";
export type ListingRef = { kind: ListingKind; id: string };

export class ModerationError extends Error {}

export async function getKeywords(tx: Tx): Promise<string[]> {
  const row = await tx.setting.findUnique({ where: { key: KEYWORDS_SETTING } });
  const v = row?.value;
  return Array.isArray(v) && v.every((k) => typeof k === "string") ? (v as string[]) : DEFAULT_KEYWORDS;
}

const target = (ref: ListingRef) => (ref.kind === "product" ? { productId: ref.id } : { serviceId: ref.id });

async function loadListing(tx: Tx, ref: ListingRef) {
  const select = { id: true, title: true, slug: true, descriptionHtml: true, businessId: true, status: true, takenDownAt: true, takenDownReason: true } as const;
  if (ref.kind === "product") {
    const p = await tx.product.findUnique({ where: { id: ref.id }, select: { ...select, brand: true, tags: true } });
    return p && { ...p, kind: ref.kind };
  }
  const s = await tx.service.findUnique({ where: { id: ref.id }, select });
  return s && { ...s, brand: null, tags: [] as string[], kind: ref.kind };
}

/**
 * Checks a listing against the prohibited-items keywords after the seller
 * saves it, and opens a review flag if anything matches (one open flag per
 * listing). Runs as TownMart code; never throws, so a seller's save always
 * succeeds.
 */
export async function screenListing(ref: ListingRef): Promise<string[]> {
  try {
    return await withSystemContext(async (tx) => {
      const listing = await loadListing(tx, ref);
      if (!listing) return [];
      const matched = matchKeywords(listing, await getKeywords(tx));
      if (matched.length === 0) return [];
      const open = await tx.listingReport.findFirst({ where: { ...target(ref), reason: "keyword_match", status: "open" }, select: { id: true } });
      if (open) await tx.listingReport.update({ where: { id: open.id }, data: { matched } });
      else await tx.listingReport.create({ data: { ...target(ref), businessId: listing.businessId, reason: "keyword_match", matched } });
      return matched;
    });
  } catch (err) {
    logger.error({ err, ref }, "screening a listing failed");
    return [];
  }
}

/** Hides a listing everywhere and closes its open reports as actioned. Returns what the seller is told. */
export async function takeDownListing(tx: Tx, ref: ListingRef, p: { reason: string; actorUserId: string; now?: Date }) {
  const listing = await loadListing(tx, ref);
  if (!listing) throw new ModerationError("Listing not found.");
  if (listing.takenDownAt) throw new ModerationError("This listing is already taken down.");
  const now = p.now ?? new Date();
  const data = { takenDownAt: now, takenDownReason: p.reason, takenDownBy: p.actorUserId };
  if (ref.kind === "product") await tx.product.update({ where: { id: ref.id }, data });
  else await tx.service.update({ where: { id: ref.id }, data });
  const resolved = await tx.listingReport.updateMany({
    where: { ...target(ref), status: "open" },
    data: { status: "actioned", resolvedAt: now, resolvedBy: p.actorUserId, resolutionNote: p.reason },
  });
  return { listing, reportsClosed: resolved.count };
}

export async function restoreListing(tx: Tx, ref: ListingRef) {
  const listing = await loadListing(tx, ref);
  if (!listing) throw new ModerationError("Listing not found.");
  if (!listing.takenDownAt) throw new ModerationError("This listing isn't taken down.");
  const data = { takenDownAt: null, takenDownReason: null, takenDownBy: null };
  if (ref.kind === "product") await tx.product.update({ where: { id: ref.id }, data });
  else await tx.service.update({ where: { id: ref.id }, data });
  return { listing };
}

export async function dismissReports(tx: Tx, ref: ListingRef, p: { note: string; actorUserId: string }) {
  const { count } = await tx.listingReport.updateMany({
    where: { ...target(ref), status: "open" },
    data: { status: "dismissed", resolvedAt: new Date(), resolvedBy: p.actorUserId, resolutionNote: p.note },
  });
  if (count === 0) throw new ModerationError("There are no open reports on this listing.");
  return count;
}

/** The moderation queue: listings with open reports, most-reported first. */
export async function reportQueue(tx: Tx) {
  const rows = await tx.listingReport.groupBy({
    by: ["productId", "serviceId"],
    where: { status: "open" },
    _count: { _all: true },
    _min: { createdAt: true },
    orderBy: [{ _count: { productId: "desc" } }],
  });
  const productIds = rows.flatMap((r) => (r.productId ? [r.productId] : []));
  const serviceIds = rows.flatMap((r) => (r.serviceId ? [r.serviceId] : []));
  const listingSelect = { id: true, title: true, slug: true, status: true, takenDownAt: true, business: { select: { id: true, name: true } } } satisfies Prisma.ProductSelect;
  const [products, services, reasons] = await Promise.all([
    tx.product.findMany({ where: { id: { in: productIds } }, select: listingSelect }),
    tx.service.findMany({ where: { id: { in: serviceIds } }, select: listingSelect }),
    tx.listingReport.findMany({ where: { status: "open" }, select: { productId: true, serviceId: true, reason: true } }),
  ]);
  type Row = (typeof products)[number] & { kind: ListingKind };
  const byId = new Map<string, Row>([...products.map((p) => [p.id, { ...p, kind: "product" }] as [string, Row]), ...services.map((s) => [s.id, { ...s, kind: "service" }] as [string, Row])]);
  return rows
    .map((r) => {
      const id = (r.productId ?? r.serviceId)!;
      const listing = byId.get(id);
      if (!listing) return null;
      const why = [...new Set(reasons.filter((x) => (x.productId ?? x.serviceId) === id).map((x) => x.reason))];
      return { listing, reports: r._count._all, firstAt: r._min.createdAt!, reasons: why };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.reports - a.reports || a.firstAt.getTime() - b.firstAt.getTime());
}
