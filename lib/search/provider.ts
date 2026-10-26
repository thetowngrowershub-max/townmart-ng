/**
 * Storefront search. Pages and actions depend on this interface only, so the
 * Postgres implementation can be swapped for Meilisearch/Typesense later
 * without touching callers.
 */

export const SEARCH_KINDS = ["all", "products", "services", "stores"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SEARCH_SORTS = ["relevance", "newest", "price_asc", "price_desc", "rating"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export type SearchQuery = {
  q?: string;
  kind: SearchKind;
  /** Matches this category and its direct subcategories. */
  categoryId?: string;
  /** Inclusive, in kobo. */
  minPriceKobo?: bigint;
  maxPriceKobo?: bigint;
  minRating?: number;
  stateId?: number;
  lgaId?: number;
  /** Products only: in stock, untracked or backorderable. */
  inStock?: boolean;
  sort: SearchSort;
  page: number;
  pageSize: number;
};

export type ProductHit = {
  id: string;
  slug: string;
  title: string;
  priceKobo: bigint;
  compareAtPriceKobo: bigint | null;
  unit: string;
  coverKey: string | null;
  coverAlt: string | null;
  ratingAvg: number;
  ratingCount: number;
  inStock: boolean;
  business: { name: string; slug: string; city: string; stateName: string };
};

export type ServiceHit = {
  id: string;
  slug: string;
  title: string;
  pricingModel: string;
  priceKobo: bigint;
  durationMinutes: number;
  coverKey: string | null;
  coverAlt: string | null;
  ratingAvg: number;
  ratingCount: number;
  business: { name: string; slug: string; city: string; stateName: string };
};

export type StoreHit = {
  id: string;
  slug: string;
  name: string;
  type: string;
  logoKey: string | null;
  city: string;
  stateName: string;
  ratingAvg: number;
  ratingCount: number;
};

export type Page<T> = { items: T[]; total: number };

export type SearchResults = {
  products: Page<ProductHit>;
  services: Page<ServiceHit>;
  stores: Page<StoreHit>;
};

export interface SearchProvider {
  search(query: SearchQuery): Promise<SearchResults>;
}
