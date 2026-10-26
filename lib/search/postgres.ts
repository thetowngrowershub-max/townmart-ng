import { Prisma } from "@prisma/client";
import { withRls, type Tx } from "@/lib/db";
import type { Page, ProductHit, SearchProvider, SearchQuery, SearchResults, ServiceHit, StoreHit } from "./provider";

const empty = <T>(): Page<T> => ({ items: [], total: 0 });

/**
 * Full-text search (websearch_to_tsquery over the trigger-maintained
 * search_vector) OR'd with trigram similarity on titles, so "tomatoe" and
 * "samsun" still find something. Every query also filters to live listings of
 * approved businesses explicitly: RLS would let a seller see their own drafts
 * here, and search must show the same results to everyone.
 */
export class PostgresSearchProvider implements SearchProvider {
  async search(query: SearchQuery): Promise<SearchResults> {
    const q = query.q?.trim().slice(0, 100) || undefined;
    const want = (k: SearchQuery["kind"]) => query.kind === "all" || query.kind === k;
    return withRls({ userId: null }, async (tx) => {
      // Sequential: one transaction is one connection.
      const products = want("products") ? await searchProducts(tx, query, q) : empty<ProductHit>();
      const services = want("services") ? await searchServices(tx, query, q) : empty<ServiceHit>();
      const stores = want("stores") ? await searchStores(tx, query, q) : empty<StoreHit>();
      return { products, services, stores };
    });
  }
}

const tsq = (q: string) => Prisma.sql`websearch_to_tsquery('english', ${q})`;

function categoryFilter(alias: string, categoryId: string | undefined) {
  if (!categoryId) return Prisma.empty;
  const col = Prisma.raw(`${alias}.category_id`);
  return Prisma.sql`AND (${col} = ${categoryId}::uuid OR ${col} IN (SELECT id FROM categories WHERE parent_id = ${categoryId}::uuid))`;
}

function priceFilter(alias: string, query: SearchQuery) {
  const col = Prisma.raw(`${alias}.base_price_kobo`);
  return Prisma.sql`
    ${query.minPriceKobo !== undefined ? Prisma.sql`AND ${col} >= ${query.minPriceKobo}` : Prisma.empty}
    ${query.maxPriceKobo !== undefined ? Prisma.sql`AND ${col} <= ${query.maxPriceKobo}` : Prisma.empty}`;
}

function ratingFilter(alias: string, query: SearchQuery) {
  return query.minRating ? Prisma.sql`AND ${Prisma.raw(`${alias}.rating_avg`)} >= ${query.minRating}` : Prisma.empty;
}

function orderBy(alias: string, query: SearchQuery, hasQ: boolean, priceCol = "base_price_kobo") {
  const a = alias;
  switch (query.sort) {
    case "price_asc":
      return Prisma.raw(`${a}.${priceCol} ASC, ${a}.id`);
    case "price_desc":
      return Prisma.raw(`${a}.${priceCol} DESC, ${a}.id`);
    case "rating":
      return Prisma.raw(`${a}.rating_avg DESC, ${a}.rating_count DESC, ${a}.id`);
    case "newest":
      return Prisma.raw(`${a}.created_at DESC, ${a}.id`);
    case "relevance":
      return hasQ ? Prisma.raw(`rank DESC, ${a}.id`) : Prisma.raw(`${a}.rating_count DESC, ${a}.created_at DESC, ${a}.id`);
  }
}

const offset = (query: SearchQuery) => (Math.max(1, query.page) - 1) * query.pageSize;

type Row = { total: bigint };

async function searchProducts(tx: Tx, query: SearchQuery, q: string | undefined): Promise<Page<ProductHit>> {
  const match = q ? Prisma.sql`AND (p.search_vector @@ ${tsq(q)} OR p.title % ${q})` : Prisma.empty;
  const rank = q ? Prisma.sql`ts_rank_cd(p.search_vector, ${tsq(q)}) + similarity(p.title, ${q})` : Prisma.sql`0`;
  const inStockExpr = Prisma.sql`(NOT p.track_inventory OR p.allow_backorder OR EXISTS (
      SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock_qty > 0))`;

  const rows = await tx.$queryRaw<
    (Row & {
      id: string; slug: string; title: string; base_price_kobo: bigint; compare_at_price_kobo: bigint | null; unit: string;
      cover_key: string | null; cover_alt: string | null; rating_avg: Prisma.Decimal; rating_count: number; in_stock: boolean;
      b_name: string; b_slug: string; b_city: string; state_name: string;
    })[]
  >`
    SELECT p.id, p.slug, p.title, p.base_price_kobo, p.compare_at_price_kobo, p.unit::text AS unit,
           p.rating_avg, p.rating_count, ${inStockExpr} AS in_stock, ${rank} AS rank,
           img.storage_key AS cover_key, img.alt_text AS cover_alt,
           b.name AS b_name, b.slug AS b_slug, b.city AS b_city, s.name AS state_name,
           count(*) OVER () AS total
      FROM products p
      JOIN businesses b ON b.id = p.business_id AND b.status = 'approved'
      JOIN states s ON s.id = b.state_id
      LEFT JOIN LATERAL (
        SELECT storage_key, alt_text FROM product_images i
         WHERE i.product_id = p.id ORDER BY i.is_cover DESC, i.sort_order LIMIT 1
      ) img ON true
     WHERE p.status = 'active' AND p.deleted_at IS NULL
       ${match}
       ${categoryFilter("p", query.categoryId)}
       ${priceFilter("p", query)}
       ${ratingFilter("p", query)}
       ${query.stateId ? Prisma.sql`AND b.state_id = ${query.stateId}` : Prisma.empty}
       ${query.lgaId ? Prisma.sql`AND b.lga_id = ${query.lgaId}` : Prisma.empty}
       ${query.inStock ? Prisma.sql`AND ${inStockExpr}` : Prisma.empty}
     ORDER BY ${orderBy("p", query, !!q)}
     LIMIT ${query.pageSize} OFFSET ${offset(query)}`;

  return {
    total: Number(rows[0]?.total ?? 0),
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      priceKobo: r.base_price_kobo,
      compareAtPriceKobo: r.compare_at_price_kobo,
      unit: r.unit,
      coverKey: r.cover_key,
      coverAlt: r.cover_alt,
      ratingAvg: Number(r.rating_avg),
      ratingCount: r.rating_count,
      inStock: r.in_stock,
      business: { name: r.b_name, slug: r.b_slug, city: r.b_city, stateName: r.state_name },
    })),
  };
}

async function searchServices(tx: Tx, query: SearchQuery, q: string | undefined): Promise<Page<ServiceHit>> {
  const match = q ? Prisma.sql`AND (sv.search_vector @@ ${tsq(q)} OR sv.title % ${q})` : Prisma.empty;
  const rank = q ? Prisma.sql`ts_rank_cd(sv.search_vector, ${tsq(q)}) + similarity(sv.title, ${q})` : Prisma.sql`0`;
  // A provider "serves" a place if they're based there or list it as a covered LGA.
  const stateFilter = query.stateId
    ? Prisma.sql`AND (b.state_id = ${query.stateId} OR EXISTS (
        SELECT 1 FROM lgas l WHERE l.id = ANY (sv.service_lga_ids) AND l.state_id = ${query.stateId}))`
    : Prisma.empty;
  const lgaFilter = query.lgaId ? Prisma.sql`AND (b.lga_id = ${query.lgaId} OR ${query.lgaId}::int = ANY (sv.service_lga_ids))` : Prisma.empty;

  const rows = await tx.$queryRaw<
    (Row & {
      id: string; slug: string; title: string; pricing_model: string; base_price_kobo: bigint; duration_minutes: number;
      cover_key: string | null; cover_alt: string | null; rating_avg: Prisma.Decimal; rating_count: number;
      b_name: string; b_slug: string; b_city: string; state_name: string;
    })[]
  >`
    SELECT sv.id, sv.slug, sv.title, sv.pricing_model::text AS pricing_model, sv.base_price_kobo, sv.duration_minutes,
           sv.rating_avg, sv.rating_count, ${rank} AS rank,
           img.storage_key AS cover_key, img.alt_text AS cover_alt,
           b.name AS b_name, b.slug AS b_slug, b.city AS b_city, s.name AS state_name,
           count(*) OVER () AS total
      FROM services sv
      JOIN businesses b ON b.id = sv.business_id AND b.status = 'approved'
      JOIN states s ON s.id = b.state_id
      LEFT JOIN LATERAL (
        SELECT storage_key, alt_text FROM service_images i WHERE i.service_id = sv.id ORDER BY i.sort_order LIMIT 1
      ) img ON true
     WHERE sv.status = 'active' AND sv.deleted_at IS NULL
       ${match}
       ${categoryFilter("sv", query.categoryId)}
       ${priceFilter("sv", query)}
       ${ratingFilter("sv", query)}
       ${stateFilter}
       ${lgaFilter}
     ORDER BY ${orderBy("sv", query, !!q)}
     LIMIT ${query.pageSize} OFFSET ${offset(query)}`;

  return {
    total: Number(rows[0]?.total ?? 0),
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      pricingModel: r.pricing_model,
      priceKobo: r.base_price_kobo,
      durationMinutes: r.duration_minutes,
      coverKey: r.cover_key,
      coverAlt: r.cover_alt,
      ratingAvg: Number(r.rating_avg),
      ratingCount: r.rating_count,
      business: { name: r.b_name, slug: r.b_slug, city: r.b_city, stateName: r.state_name },
    })),
  };
}

async function searchStores(tx: Tx, query: SearchQuery, q: string | undefined): Promise<Page<StoreHit>> {
  const match = q ? Prisma.sql`AND (b.name % ${q} OR b.name ILIKE ${"%" + q.replace(/[\\%_]/g, "\\$&") + "%"})` : Prisma.empty;
  const rank = q ? Prisma.sql`similarity(b.name, ${q})` : Prisma.sql`0`;
  const category = query.categoryId
    ? Prisma.sql`AND (
        EXISTS (SELECT 1 FROM products p WHERE p.business_id = b.id AND p.status = 'active' AND p.deleted_at IS NULL ${categoryFilter("p", query.categoryId)})
        OR EXISTS (SELECT 1 FROM services sv WHERE sv.business_id = b.id AND sv.status = 'active' AND sv.deleted_at IS NULL ${categoryFilter("sv", query.categoryId)}))`
    : Prisma.empty;
  // Stores have no price; price sorts fall back to rating.
  const sortQuery: SearchQuery = query.sort === "price_asc" || query.sort === "price_desc" ? { ...query, sort: "rating" } : query;

  const rows = await tx.$queryRaw<
    (Row & {
      id: string; slug: string; name: string; type: string; logo_key: string | null; city: string; state_name: string;
      rating_avg: Prisma.Decimal; rating_count: number;
    })[]
  >`
    SELECT b.id, b.slug, b.name, b.type::text AS type, b.logo_key, b.city, s.name AS state_name,
           b.rating_avg, b.rating_count, ${rank} AS rank, count(*) OVER () AS total
      FROM businesses b
      JOIN states s ON s.id = b.state_id
     WHERE b.status = 'approved'
       ${match}
       ${category}
       ${ratingFilter("b", query)}
       ${query.stateId ? Prisma.sql`AND b.state_id = ${query.stateId}` : Prisma.empty}
       ${query.lgaId ? Prisma.sql`AND b.lga_id = ${query.lgaId}` : Prisma.empty}
     ORDER BY ${orderBy("b", sortQuery, !!q)}
     LIMIT ${query.pageSize} OFFSET ${offset(query)}`;

  return {
    total: Number(rows[0]?.total ?? 0),
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      type: r.type,
      logoKey: r.logo_key,
      city: r.city,
      stateName: r.state_name,
      ratingAvg: Number(r.rating_avg),
      ratingCount: r.rating_count,
    })),
  };
}
