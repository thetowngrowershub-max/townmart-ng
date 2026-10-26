import { z } from "zod";
import { PostgresSearchProvider } from "./postgres";
import { SEARCH_KINDS, SEARCH_SORTS, type SearchProvider, type SearchQuery } from "./provider";

export * from "./provider";

let provider: SearchProvider | undefined;
export function searchProvider(): SearchProvider {
  return (provider ??= new PostgresSearchProvider());
}

const optionalInt = z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional());
const optionalNaira = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.coerce.number().min(0).max(1_000_000_000).optional(),
);

/** Parses URL search params leniently: anything invalid falls back to its default instead of erroring. */
const searchParamsSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  kind: z.enum(SEARCH_KINDS).catch("all"),
  sort: z.enum(SEARCH_SORTS).catch("relevance"),
  page: z.coerce.number().int().min(1).max(500).catch(1),
  min: optionalNaira.catch(undefined),
  max: optionalNaira.catch(undefined),
  rating: z.coerce.number().min(1).max(5).optional().catch(undefined),
  state: optionalInt.catch(undefined),
  lga: optionalInt.catch(undefined),
  instock: z.literal("1").optional().catch(undefined),
});

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseSearchParams(
  raw: RawSearchParams,
  defaults: { categoryId?: string; pageSize?: number } = {},
): SearchQuery {
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const p = searchParamsSchema.parse(flat);
  return {
    q: p.q?.trim() || undefined,
    kind: p.kind,
    sort: p.sort,
    page: p.page,
    pageSize: defaults.pageSize ?? (p.kind === "all" ? 8 : 24),
    categoryId: defaults.categoryId,
    minPriceKobo: p.min !== undefined ? BigInt(Math.round(p.min * 100)) : undefined,
    maxPriceKobo: p.max !== undefined ? BigInt(Math.round(p.max * 100)) : undefined,
    minRating: p.rating,
    stateId: p.state,
    lgaId: p.lga,
    inStock: p.instock === "1",
  };
}
