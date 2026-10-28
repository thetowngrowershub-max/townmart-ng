import "server-only";
import { cache } from "react";
import { withRls } from "@/lib/db";
import type { StoreHit } from "@/lib/search/provider";
import { publicImageUrl } from "@/lib/storage";

/** Public reads of TownMart's own content run as a guest; RLS hides inactive banners and unpublished answers. */
const asGuest = <T,>(fn: Parameters<typeof withRls<T>>[1]) => withRls({ userId: null }, fn);

export async function getHomepageBanners(now = new Date()) {
  const rows = await asGuest((tx) =>
    tx.cmsBanner.findMany({
      where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 6,
    }),
  );
  return rows.map((b) => ({ ...b, imageUrl: b.imageKey ? publicImageUrl(b.imageKey) : null }));
}

/** Featured stores that are still approved, in the order TownMart chose. */
export async function getFeaturedStores(): Promise<StoreHit[]> {
  const rows = await asGuest((tx) =>
    tx.featuredStore.findMany({
      where: { business: { status: "approved" } },
      orderBy: { sortOrder: "asc" },
      select: { business: { select: { id: true, name: true, slug: true, type: true, logoKey: true, city: true, ratingAvg: true, ratingCount: true, state: { select: { name: true } } } } },
    }),
  );
  return rows.map(({ business: b }) => ({ id: b.id, slug: b.slug, name: b.name, type: b.type, logoKey: b.logoKey, city: b.city, stateName: b.state.name, ratingAvg: Number(b.ratingAvg), ratingCount: b.ratingCount }));
}

export const getFaq = cache(async () => {
  const rows = await asGuest((tx) => tx.faqEntry.findMany({ where: { isPublished: true }, orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, section: true, question: true, answerHtml: true } }));
  const sections = new Map<string, typeof rows>();
  for (const r of rows) sections.set(r.section, [...(sections.get(r.section) ?? []), r]);
  return [...sections.entries()].map(([name, entries]) => ({ name, entries }));
});

export const getCmsPage = cache((slug: string) => asGuest((tx) => tx.cmsPage.findUnique({ where: { slug } })));
