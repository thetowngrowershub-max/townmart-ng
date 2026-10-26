import type { MetadataRoute } from "next";
import { withRls } from "@/lib/db";

// Rendered per request (cached by the CDN), so builds never need a database.
export const dynamic = "force-dynamic";

/** Public catalogue URLs. Read as a guest, so only live listings of approved sellers appear. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const live = { status: "active", deletedAt: null, business: { status: "approved" } } as const;
  const { categories, products, services, stores } = await withRls({ userId: null }, async (tx) => ({
    categories: await tx.category.findMany({ where: { isActive: true }, select: { slug: true, parent: { select: { slug: true } } } }),
    products: await tx.product.findMany({ where: live, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 20_000 }),
    services: await tx.service.findMany({ where: live, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 10_000 }),
    stores: await tx.business.findMany({ where: { status: "approved" }, select: { slug: true, updatedAt: true }, take: 10_000 }),
  }));
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/sell`, changeFrequency: "monthly", priority: 0.5 },
    ...categories.map((c) => ({ url: `${base}/c/${c.parent ? `${c.parent.slug}/` : ""}${c.slug}`, changeFrequency: "daily" as const, priority: 0.7 })),
    ...products.map((p) => ({ url: `${base}/p/${p.slug}`, lastModified: p.updatedAt, priority: 0.6 })),
    ...services.map((s) => ({ url: `${base}/s/${s.slug}`, lastModified: s.updatedAt, priority: 0.6 })),
    ...stores.map((b) => ({ url: `${base}/store/${b.slug}`, lastModified: b.updatedAt, priority: 0.5 })),
  ];
}
