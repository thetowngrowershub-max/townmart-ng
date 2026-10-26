import type { Metadata } from "next";
import Link from "next/link";
import { CardGrid, ProductCard, ServiceCard, StoreCard } from "@/components/storefront/listing-cards";
import { Pagination } from "@/components/storefront/pagination";
import { SearchFilters } from "@/components/storefront/search-filters";
import { SearchForm } from "@/components/layout/search-form";
import { Alert } from "@/components/ui/alert";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { parseSearchParams, searchProvider, type RawSearchParams, type SearchKind } from "@/lib/search";
import { locationOptions, withParams } from "@/lib/search/locations";
import { cn } from "@/lib/utils";

type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = parseSearchParams(await searchParams).q;
  return { title: q ? `“${q}”: search results` : "Search", robots: { index: false, follow: true } };
}

const KINDS: { kind: SearchKind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "products", label: "Products" },
  { kind: "services", label: "Services" },
  { kind: "stores", label: "Stores" },
];

export default async function SearchPage({ searchParams }: Props) {
  const raw = await searchParams;
  const query = parseSearchParams(raw);
  const meta = await requestMeta();
  const limited = !(await rateLimit(`search:${meta.ipHash}`, 120, 60)).allowed;

  const [results, locations] = limited
    ? [null, await locationOptions(query.stateId)]
    : await Promise.all([searchProvider().search(query), locationOptions(query.stateId)]);
  const total = results ? results.products.total + results.services.total + results.stores.total : 0;

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4">
        <SearchForm id="q-page" key={query.q} defaultValue={query.q} className="max-w-2xl" />
        <h1 className="text-2xl font-bold">
          {query.q ? (
            <>
              Results for <span className="text-primary">“{query.q}”</span>
            </>
          ) : (
            "Browse everything"
          )}
        </h1>
        <nav aria-label="Result type" className="flex gap-2 overflow-x-auto">
          {KINDS.map((k) => (
            <Link
              key={k.kind}
              href={withParams("/search", raw, { kind: k.kind === "all" ? undefined : k.kind, page: undefined })}
              aria-current={k.kind === query.kind ? "page" : undefined}
              className={cn("rounded-full border px-4 py-1.5 text-sm", k.kind === query.kind ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
            >
              {k.label}
              {results && k.kind !== "all" && query.kind === "all" && <span className="text-muted-foreground"> ({results[k.kind].total})</span>}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside>
          <SearchFilters action="/search" query={query} locations={locations} showStock={query.kind === "products" || query.kind === "all"} showPrice={query.kind !== "stores"} />
        </aside>
        <div className="flex min-w-0 flex-col gap-10">
          {limited && <Alert variant="warning">You&apos;re searching very fast. Please wait a minute and try again.</Alert>}
          {results && total === 0 && (
            <div className="rounded-2xl border bg-card p-8 text-center">
              <p className="font-semibold">Nothing found{query.q ? ` for “${query.q}”` : ""}.</p>
              <p className="mt-1 text-sm text-muted-foreground">Try fewer words, check the spelling, or remove some filters.</p>
            </div>
          )}
          {results && (query.kind === "all" || query.kind === "products") && results.products.total > 0 && (
            <section aria-labelledby="r-products">
              <SectionHead id="r-products" title="Products" total={results.products.total} more={query.kind === "all" ? withParams("/search", raw, { kind: "products", page: undefined }) : undefined} />
              <CardGrid>
                {results.products.items.map((p) => (
                  <ProductCard key={p.id} p={p} />
                ))}
              </CardGrid>
              {query.kind === "products" && (
                <Pagination page={query.page} total={results.products.total} pageSize={query.pageSize} href={(n) => withParams("/search", raw, { page: n > 1 ? String(n) : undefined })} />
              )}
            </section>
          )}
          {results && (query.kind === "all" || query.kind === "services") && results.services.total > 0 && (
            <section aria-labelledby="r-services">
              <SectionHead id="r-services" title="Services" total={results.services.total} more={query.kind === "all" ? withParams("/search", raw, { kind: "services", page: undefined }) : undefined} />
              <CardGrid>
                {results.services.items.map((s) => (
                  <ServiceCard key={s.id} s={s} />
                ))}
              </CardGrid>
              {query.kind === "services" && (
                <Pagination page={query.page} total={results.services.total} pageSize={query.pageSize} href={(n) => withParams("/search", raw, { page: n > 1 ? String(n) : undefined })} />
              )}
            </section>
          )}
          {results && (query.kind === "all" || query.kind === "stores") && results.stores.total > 0 && (
            <section aria-labelledby="r-stores">
              <SectionHead id="r-stores" title="Stores" total={results.stores.total} more={query.kind === "all" ? withParams("/search", raw, { kind: "stores", page: undefined }) : undefined} />
              <div className="grid gap-4 sm:grid-cols-2">
                {results.stores.items.map((s) => (
                  <StoreCard key={s.id} s={s} />
                ))}
              </div>
              {query.kind === "stores" && (
                <Pagination page={query.page} total={results.stores.total} pageSize={query.pageSize} href={(n) => withParams("/search", raw, { page: n > 1 ? String(n) : undefined })} />
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function SectionHead({ id, title, total, more }: { id: string; title: string; total: number; more?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 id={id} className="text-xl font-bold">
        {title} <span className="text-base font-normal text-muted-foreground">({total.toLocaleString("en-NG")})</span>
      </h2>
      {more && (
        <Link href={more} className="text-sm font-semibold text-primary underline">
          See all
        </Link>
      )}
    </div>
  );
}
