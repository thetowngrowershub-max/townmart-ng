import Link from "next/link";
import { notFound } from "next/navigation";
import { CardGrid, ProductCard, ServiceCard } from "@/components/storefront/listing-cards";
import { Pagination } from "@/components/storefront/pagination";
import { SearchFilters } from "@/components/storefront/search-filters";
import { withRls } from "@/lib/db";
import { parseSearchParams, searchProvider, type RawSearchParams } from "@/lib/search";
import { locationOptions, withParams } from "@/lib/search/locations";
import { cn } from "@/lib/utils";

export async function loadCategory(slug: string, subSlug?: string) {
  return withRls({ userId: null }, async (tx) => {
    const top = await tx.category.findFirst({
      where: { slug, parentId: null, isActive: true },
      select: { id: true, name: true, slug: true, kind: true, children: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true } } },
    });
    if (!top) return null;
    const sub = subSlug ? top.children.find((c) => c.slug === subSlug) : undefined;
    if (subSlug && !sub) return null;
    return { top, sub };
  });
}

/** Category and subcategory listing, powered by the same search provider as /search. */
export async function CategoryListing({ slug, subSlug, searchParams }: { slug: string; subSlug?: string; searchParams: RawSearchParams }) {
  const cat = await loadCategory(slug, subSlug);
  if (!cat) notFound();
  const { top, sub } = cat;
  const path = sub ? `/c/${top.slug}/${sub.slug}` : `/c/${top.slug}`;
  const isProducts = top.kind === "product";
  const query = { ...parseSearchParams(searchParams, { categoryId: (sub ?? top).id, pageSize: 24 }), kind: isProducts ? ("products" as const) : ("services" as const) };
  const [results, locations] = await Promise.all([searchProvider().search(query), locationOptions(query.stateId)]);
  const page = isProducts ? results.products : results.services;

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href="/" className="hover:underline">
              Home
            </Link>{" "}
            /
          </li>
          <li>{sub ? <Link href={`/c/${top.slug}`} className="hover:underline">{top.name}</Link> : <span aria-current="page">{top.name}</span>}</li>
          {sub && (
            <li>
              / <span aria-current="page">{sub.name}</span>
            </li>
          )}
        </ol>
      </nav>
      <h1 className="text-3xl font-bold">{(sub ?? top).name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {page.total.toLocaleString("en-NG")} {isProducts ? "product" : "service"}
        {page.total === 1 ? "" : "s"}
      </p>
      {top.children.length > 0 && (
        <nav aria-label="Subcategories" className="mt-4 flex gap-2 overflow-x-auto pb-1">
          <Link href={`/c/${top.slug}`} className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-sm", !sub ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}>
            All
          </Link>
          {top.children.map((c) => (
            <Link
              key={c.id}
              href={`/c/${top.slug}/${c.slug}`}
              aria-current={sub?.id === c.id ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-sm", sub?.id === c.id ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}
      <div className="mt-6 grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside>
          <SearchFilters action={path} query={{ ...query, kind: "all" }} locations={locations} showStock={isProducts} />
        </aside>
        <div className="min-w-0">
          {page.total === 0 ? (
            <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">Nothing here yet. Try removing some filters.</div>
          ) : (
            <CardGrid>
              {isProducts ? results.products.items.map((p) => <ProductCard key={p.id} p={p} />) : results.services.items.map((s) => <ServiceCard key={s.id} s={s} />)}
            </CardGrid>
          )}
          <Pagination page={query.page} total={page.total} pageSize={query.pageSize} href={(n) => withParams(path, searchParams, { page: n > 1 ? String(n) : undefined })} />
        </div>
      </div>
    </main>
  );
}
