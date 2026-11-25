import "server-only";
import { withRls } from "@/lib/db";
import { searchProvider, type ProductHit, type ServiceHit } from "@/lib/search";

export type HomeCategory = {
  id: string;
  slug: string;
  name: string;
  /** The emoji set on the category, shown when no listing has a photo yet. */
  icon: string | null;
  kind: "product" | "service";
  /** Live listings in the category and its subcategories. */
  count: number;
  coverKey: string | null;
  coverAlt: string | null;
};

/**
 * Top-level categories for the home page thumbnails, straight from the
 * category table: a category an admin adds (or switches off) shows up here
 * without a code change. Each thumbnail borrows the photo of the category's
 * best-rated live listing, through the same search the storefront uses, so it
 * never shows a hidden, unapproved or out-of-area listing.
 */
export async function getHomeCategories(): Promise<HomeCategory[]> {
  const categories = await withRls({ userId: null }, (tx) =>
    tx.category.findMany({
      where: { parentId: null, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, icon: true, kind: true },
    }),
  );
  const search = searchProvider();
  return Promise.all(
    categories.map(async (c) => {
      const kind = c.kind === "product" ? ("products" as const) : ("services" as const);
      const results = await search
        .search({
          kind,
          categoryId: c.id,
          sort: "rating",
          page: 1,
          pageSize: 4,
        })
        .catch(() => null);
      const page = results ? (kind === "products" ? results.products : results.services) : { items: [], total: 0 };
      const cover = (page.items as (ProductHit | ServiceHit)[]).find((i) => i.coverKey);
      return {
        ...c,
        count: page.total,
        coverKey: cover?.coverKey ?? null,
        coverAlt: cover?.coverAlt ?? null,
      };
    }),
  );
}

/** The home page catalogue: best-rated products and services, plus the photos for the hero. */
export async function getHomeCatalogue({ products = 10, services = 5 } = {}) {
  const search = searchProvider();
  const base = { sort: "rating", page: 1 } as const;
  const [p, s] = await Promise.all([search.search({ ...base, kind: "products", pageSize: products }), search.search({ ...base, kind: "services", pageSize: services })]);
  return { products: p.products, services: s.services };
}
