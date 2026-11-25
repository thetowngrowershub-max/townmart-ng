import Image from "next/image";
import Link from "next/link";
import { CategoryThumbnails } from "@/components/storefront/category-thumbnails";
import { FlashDeals } from "@/components/storefront/flash-deals";
import { HomeHero } from "@/components/storefront/home-hero";
import { CardGrid, ProductCard, ServiceCard, StoreCard } from "@/components/storefront/listing-cards";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getHomeCatalogue, getHomeCategories } from "@/lib/catalogue/home";
import { getFeaturedStores, getHomepageBanners } from "@/lib/cms/public";

// Flash deals change by the minute, so the home page renders per request.
export const dynamic = "force-dynamic";

function SectionHeading({ id, title, href, linkLabel }: { id: string; title: string; href: string; linkLabel: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 id={id} className="text-2xl font-bold">
        {title}
      </h2>
      <Link href={href} className="shrink-0 text-sm font-semibold text-primary underline">
        {linkLabel}
      </Link>
    </div>
  );
}

export default async function HomePage() {
  const [banners, featured, categories, catalogue] = await Promise.all([getHomepageBanners(), getFeaturedStores(), getHomeCategories(), getHomeCatalogue({ products: 8, services: 4 })]);
  // The hero shows photos of the products that lead the catalogue below it.
  const products = catalogue.products.items;
  const services = catalogue.services.items;
  return (
    <main id="main">
      <HomeHero picks={products} />

      {/* Category thumbnails sit directly above the catalogue they filter. */}
      <div id="catalogue" className="mx-auto flex max-w-7xl scroll-mt-28 flex-col gap-12 px-4 py-12">
        <CategoryThumbnails categories={categories} />

        <div className="empty:hidden">
          <FlashDeals />
        </div>

        {products.length > 0 && (
          <section aria-labelledby="popular-products">
            <SectionHeading id="popular-products" title="Popular products" href="/search?kind=products&sort=rating" linkLabel={`See all ${catalogue.products.total.toLocaleString("en-NG")}`} />
            <CardGrid>
              {products.map((p) => (
                <ProductCard key={p.id} p={p} />
              ))}
            </CardGrid>
          </section>
        )}

        {services.length > 0 && (
          <section aria-labelledby="popular-services">
            <SectionHeading id="popular-services" title="Services and artisans" href="/search?kind=services&sort=rating" linkLabel={`See all ${catalogue.services.total.toLocaleString("en-NG")}`} />
            <CardGrid>
              {services.map((s) => (
                <ServiceCard key={s.id} s={s} />
              ))}
            </CardGrid>
          </section>
        )}
      </div>

      {banners.length > 0 && (
        <section aria-label="Featured on TownMart" className="mx-auto max-w-7xl px-4 pb-12">
          <ul className={banners.length > 1 ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
            {banners.map((b) => (
              <li key={b.id}>
                <Card className="relative flex min-h-44 overflow-hidden p-0">
                  {b.imageUrl && <Image src={b.imageUrl} alt="" fill sizes={banners.length > 1 ? "(min-width: 768px) 50vw, 100vw" : "100vw"} className="object-cover" />}
                  <div
                    className={
                      b.imageUrl
                        ? "relative mt-auto flex w-full flex-col items-start gap-2 bg-gradient-to-t from-black/75 to-transparent p-6 pt-16 text-white"
                        : "flex w-full flex-col items-start justify-center gap-2 bg-accent-soft p-6"
                    }
                  >
                    <h2 className="text-xl font-bold sm:text-2xl">{b.title}</h2>
                    {b.subtitle && <p className={b.imageUrl ? "text-sm text-white/90" : "text-sm text-muted-foreground"}>{b.subtitle}</p>}
                    {b.linkUrl && (
                      <Button asChild size="sm" variant={b.imageUrl ? "secondary" : "default"} className="mt-1">
                        <Link href={b.linkUrl}>{b.ctaLabel || "Take a look"}</Link>
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {featured.length > 0 && (
        <section aria-labelledby="featured-stores" className="mx-auto max-w-7xl px-4 pb-4">
          <h2 id="featured-stores" className="mb-6 text-2xl font-bold">
            Featured stores
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((s) => (
              <li key={s.id}>
                <StoreCard s={s} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-4 py-12">
        <Card className="flex flex-col items-start gap-4 bg-accent-soft p-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold">Sell on TownMart</h2>
            <p className="text-muted-foreground">Open your store or list your services and reach customers in your area.</p>
          </div>
          <Button asChild variant="accent" size="lg">
            <Link href="/sell">Start selling</Link>
          </Button>
        </Card>
      </section>
    </main>
  );
}
