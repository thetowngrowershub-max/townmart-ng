/**
 * Storefront search. Pages and actions depend on this interface only, so the
 * Postgres implementation can be swapped for Meilisearch/Typesense later
 * without touching callers.
 */

export const SEARCH_KINDS = ["all", "products", "services", "stores"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

import type { ListingDeal } from "@/lib/pricing";

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
  /** Only this store's listings (store pages). */
  businessId?: string;
  /** Products only: in stock, untracked or backorderable. */
  inStock?: boolean;
  /** Only listings with a live automatic promotion ("flash": a live flash deal). */
  promotion?: "any" | "flash";
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
  /** The best live automatic promotion, if any. priceKobo stays the undiscounted price. */
  deal: ListingDeal | null;
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
  deal: ListingDeal | null;
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
