import { BadgeCheck, ShieldCheck, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { SearchForm } from "@/components/layout/search-form";
import { FlashDeals } from "@/components/storefront/flash-deals";
import { StoreCard } from "@/components/storefront/listing-cards";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getFeaturedStores, getHomepageBanners } from "@/lib/cms/public";
import { storefrontCategories } from "@/lib/navigation";

// Flash deals change by the minute, so the home page renders per request.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [banners, featured] = await Promise.all([getHomepageBanners(), getFeaturedStores()]);
  return (
    <main id="main">
      <section className="bg-primary text-primary-foreground dark:bg-primary-soft dark:text-foreground">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-14 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-wider opacity-80">Shop local. Book local.</p>
          <h1 className="max-w-2xl text-4xl font-extrabold sm:text-5xl">Everything your town sells, in one place.</h1>
          <p className="max-w-xl text-lg opacity-90">
            Groceries, fashion, electronics and fresh farm produce, plus trusted plumbers, tailors and other artisans near
            you.
          </p>
          <SearchForm id="q-hero" size="lg" className="max-w-2xl text-foreground" />
        </div>
      </section>

      {banners.length > 0 && (
        <section aria-label="Featured on TownMart" className="mx-auto max-w-7xl px-4 pt-12">
          <ul className={banners.length > 1 ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
            {banners.map((b, i) => (
              <li key={b.id}>
                <Card className="relative flex min-h-44 overflow-hidden p-0">
                  {b.imageUrl && (
                    <Image src={b.imageUrl} alt="" fill priority={i === 0} sizes={banners.length > 1 ? "(min-width: 768px) 50vw, 100vw" : "100vw"} className="object-cover" />
                  )}
                  <div className={b.imageUrl ? "relative mt-auto flex w-full flex-col items-start gap-2 bg-gradient-to-t from-black/75 to-transparent p-6 pt-16 text-white" : "flex w-full flex-col items-start justify-center gap-2 bg-accent-soft p-6"}>
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

      <div className="mx-auto max-w-7xl px-4 pt-12 empty:hidden">
        <FlashDeals />
      </div>

      <section aria-labelledby="categories" className="mx-auto max-w-7xl px-4 py-12">
        <h2 id="categories" className="mb-6 text-2xl font-bold">
          Shop by category
        </h2>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {storefrontCategories.map((c) => (
            <li key={c.slug}>
              <Link href={`/c/${c.slug}`} className="block focus-visible:outline-none">
                <Card className="flex h-full flex-col items-center gap-3 p-6 text-center transition-shadow hover:shadow-md">
                  <span className="text-4xl" aria-hidden>
                    {c.emoji}
                  </span>
                  <span className="font-semibold">{c.label}</span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {featured.length > 0 && (
        <section aria-labelledby="featured-stores" className="mx-auto max-w-7xl px-4 pb-12">
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

      <section aria-label="Why TownMart" className="mx-auto max-w-7xl px-4 pb-4">
        <ul className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: BadgeCheck, title: "Verified sellers", body: "Every store is reviewed before it can sell." },
            { icon: ShieldCheck, title: "Protected payments", body: "Sellers are paid only after your order is delivered." },
            { icon: Truck, title: "Clear delivery fees", body: "See the full price, delivery included, before you pay." },
          ].map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <Card className="flex gap-4 p-6">
                <Icon className="size-6 shrink-0 text-primary" aria-hidden />
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground">{body}</p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

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
