import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import type { ComputedLine } from "@/lib/checkout/compute";
import { haversineMetres, type LatLng } from "@/lib/geo/distance";
import { inServiceAreaSql } from "@/lib/service-area-db";

/**
 * "Closer shop has this": for each product in the cart, the same item (a
 * close title match in the same category, in stock) at a shop nearer the
 * shopper than the one in the cart. A nearer shop means a cheaper, quicker
 * delivery. Only suggests: the shopper decides.
 */
export type NearerOffer = { productSlug: string; title: string; storeName: string; metres: number; savedMetres: number; priceKobo: bigint };

/** A nearer shop must save at least this much distance to be worth mentioning. */
const MIN_SAVING_M = 500;
/** Title similarity (pg_trgm, 0 to 1) that counts as the same item. */
const SAME_ITEM = 0.45;

export async function nearerOffers(tx: Tx, lines: readonly ComputedLine[], customer: LatLng | null): Promise<Map<string, NearerOffer>> {
  const out = new Map<string, NearerOffer>();
  if (!customer) return out;
  const products = lines.filter((l) => l.kind === "product" && l.productId && !l.savedForLater).slice(0, 20);
  if (products.length === 0) return out;
  const shops = await tx.business.findMany({ where: { id: { in: [...new Set(products.map((l) => l.businessId))] } }, select: { id: true, latitude: true, longitude: true } });
  const shopAt = new Map(shops.map((b) => [b.id, b.latitude !== null && b.longitude !== null ? { lat: b.latitude, lng: b.longitude } : null]));

  for (const l of products) {
    const shop = shopAt.get(l.businessId);
    // Unknown shop location: we can't tell whether another shop is nearer.
    if (!shop) continue;
    const current = haversineMetres(shop, customer);
    if (current < MIN_SAVING_M * 2) continue;
    const cat = l.parentCategoryId ?? l.categoryId;
    const rows = await tx.$queryRaw<{ slug: string; title: string; b_name: string; latitude: number; longitude: number; base_price_kobo: bigint }[]>`
      SELECT p.slug, p.title, b.name AS b_name, b.latitude, b.longitude, p.base_price_kobo
        FROM products p
        JOIN businesses b ON b.id = p.business_id AND b.status = 'approved' AND b.latitude IS NOT NULL
        JOIN categories c ON c.id = p.category_id
       WHERE p.status = 'active' AND p.deleted_at IS NULL AND p.taken_down_at IS NULL
         AND p.business_id <> ${l.businessId}::uuid
         AND (c.id = ${cat}::uuid OR c.parent_id = ${cat}::uuid)
         AND similarity(p.title, ${l.title}) >= ${SAME_ITEM}
         AND (NOT p.track_inventory OR p.allow_backorder OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock_qty >= ${new Prisma.Decimal(l.qty)}))
         AND ${inServiceAreaSql("b.lga_id")}
       ORDER BY similarity(p.title, ${l.title}) DESC
       LIMIT 10`;
    const best = rows
      .map((r) => ({ r, metres: haversineMetres({ lat: r.latitude, lng: r.longitude }, customer) }))
      .filter((x) => x.metres <= current - MIN_SAVING_M)
      .sort((a, b) => a.metres - b.metres)[0];
    if (best)
      out.set(l.cartItemId, {
        productSlug: best.r.slug,
        title: best.r.title,
        storeName: best.r.b_name,
        metres: Math.round(best.metres),
        savedMetres: Math.round(current - best.metres),
        priceKobo: best.r.base_price_kobo,
      });
  }
  return out;
}
