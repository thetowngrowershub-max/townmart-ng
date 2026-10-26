import type { Metadata } from "next";
import Link from "next/link";
import { FlashDeals } from "@/components/storefront/flash-deals";
import { CardGrid, ProductCard, ServiceCard } from "@/components/storefront/listing-cards";
import { Pagination } from "@/components/storefront/pagination";
import { parseSearchParams, searchProvider, type RawSearchParams } from "@/lib/search";
import { withParams } from "@/lib/search/locations";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Deals",
  description: "Discounts and flash deals from verified sellers and service providers on TownMart.",
  alternates: { canonical: "/deals" },
};

type Props = { searchParams: Promise<RawSearchParams> };

export default async function DealsPage({ searchParams }: Props) {
  const raw = await searchParams;
  const kind = raw.kind === "services" ? "services" : "products";
  const query = { ...parseSearchParams(raw, { pageSize: 24 }), kind, promotion: "any" } as const;
  const results = await searchProvider().search(query);
  const page = kind === "products" ? results.products : results.services;

  return (
    <main id="main" className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold">Deals</h1>
        <p className="mt-1 text-muted-foreground">Real discounts with real end dates. The price you see is the price you pay for the item.</p>
      </div>

      {query.page === 1 && <FlashDeals />}

      <section aria-labelledby="all-deals">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <h2 id="all-deals" className="text-2xl font-bold">
            Everything on promotion <span className="text-base font-normal text-muted-foreground">({page.total.toLocaleString("en-NG")})</span>
          </h2>
          <nav aria-label="Deal type" className="flex gap-2">
            {(["products", "services"] as const).map((k) => (
              <Link
                key={k}
                href={withParams("/deals", raw, { kind: k === "products" ? undefined : k, page: undefined })}
                aria-current={k === kind ? "page" : undefined}
                className={cn("rounded-full border px-4 py-1.5 text-sm capitalize", k === kind ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
              >
                {k}
              </Link>
            ))}
          </nav>
        </div>
        {page.total === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">No {kind} on promotion right now. Check back soon.</div>
        ) : (
          <>
            <CardGrid>
              {kind === "products"
                ? results.products.items.map((p) => <ProductCard key={p.id} p={p} />)
                : results.services.items.map((s) => <ServiceCard key={s.id} s={s} />)}
            </CardGrid>
            <Pagination page={query.page} total={page.total} pageSize={query.pageSize} href={(n) => withParams("/deals", raw, { page: n > 1 ? String(n) : undefined })} />
          </>
        )}
      </section>
    </main>
  );
}
