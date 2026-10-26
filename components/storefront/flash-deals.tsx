import { Zap } from "lucide-react";
import Link from "next/link";
import { CardGrid, ProductCard, ServiceCard } from "@/components/storefront/listing-cards";
import { searchProvider } from "@/lib/search";

/** Listings with a live flash deal. Renders nothing when there are none. */
export async function FlashDeals({ limit = 8, headingLevel = "h2" }: { limit?: number; headingLevel?: "h1" | "h2" }) {
  const search = searchProvider();
  const base = { promotion: "flash", sort: "newest", page: 1, pageSize: limit } as const;
  const [products, services] = await Promise.all([search.search({ ...base, kind: "products" }), search.search({ ...base, kind: "services" })]);
  const items = [
    ...products.products.items.map((p) => ({ kind: "product" as const, p, ends: p.deal?.endsAt.getTime() ?? Infinity })),
    ...services.services.items.map((s) => ({ kind: "service" as const, s, ends: s.deal?.endsAt.getTime() ?? Infinity })),
  ]
    .sort((a, b) => a.ends - b.ends)
    .slice(0, limit);
  if (items.length === 0) return null;
  const Heading = headingLevel;

  return (
    <section aria-labelledby="flash-deals">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <Heading id="flash-deals" className="flex items-center gap-2 text-2xl font-bold">
          <Zap className="size-6 text-danger" aria-hidden /> Flash deals
        </Heading>
        <Link href="/deals" className="text-sm font-semibold text-primary underline">
          All deals
        </Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Short sales from local sellers. Each card shows when its deal ends.</p>
      <CardGrid>{items.map((i) => (i.kind === "product" ? <ProductCard key={i.p.id} p={i.p} /> : <ServiceCard key={i.s.id} s={i.s} />))}</CardGrid>
    </section>
  );
}
