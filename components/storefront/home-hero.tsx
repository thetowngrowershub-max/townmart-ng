import { ArrowRight, BadgeCheck, ShieldCheck, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { SearchForm } from "@/components/layout/search-form";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/money";
import type { ProductHit } from "@/lib/search";
import { publicImageUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";

const PROMISES = [
  { icon: BadgeCheck, label: "Verified sellers" },
  { icon: ShieldCheck, label: "Protected payments" },
  { icon: Truck, label: "Delivery fee shown upfront" },
];

/** One product photo in the hero, with its name, store and price on a dark scrim. */
function HeroTile({ p, big, priority, className }: { p: ProductHit; big?: boolean; priority?: boolean; className?: string }) {
  const price = p.deal ? p.deal.finalKobo : p.priceKobo;
  return (
    <Link
      href={`/p/${p.slug}`}
      className={cn(
        "group relative block overflow-hidden rounded-2xl bg-primary-soft shadow-lg ring-1 ring-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        className,
      )}
    >
      <Image
        src={publicImageUrl(p.coverKey!)}
        alt={p.coverAlt ?? p.title}
        fill
        priority={priority}
        sizes={big ? "(min-width: 1024px) 340px, 75vw" : "(min-width: 1024px) 220px, 75vw"}
        className="object-cover transition-transform duration-300 group-hover:scale-105"
      />
      {p.deal && <span className="absolute top-3 left-3 rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-accent-foreground">-{p.deal.percentOff}%</span>}
      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/85 via-black/60 to-transparent p-3 pt-10 text-white">
        <span className={cn("line-clamp-2 font-semibold leading-snug", big ? "text-base sm:text-lg" : "text-sm")}>{p.title}</span>
        <span className="truncate text-xs text-white/85">{p.business.name}</span>
        <span className="mt-1 flex items-center justify-between gap-2">
          <span className="font-heading text-base font-bold tabular-nums">{formatPrice(price)}</span>
          {big && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-bold text-primary">
              Buy now <ArrowRight className="size-3.5" aria-hidden />
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

/**
 * The landing page hero: the pitch, two calls to action and the search box on
 * the left; real product photos from live listings on the right (a swipeable
 * row on phones). Without photos it falls back to text only.
 */
export function HomeHero({ picks }: { picks: ProductHit[] }) {
  const tiles = picks.filter((p) => p.coverKey).slice(0, 3);
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden bg-primary text-primary-foreground dark:bg-primary-soft dark:text-foreground">
      {/* Soft orange glow behind the photos; decoration only. */}
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-accent/25 blur-3xl" />
      <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center lg:gap-12 lg:py-16">
        <div className="flex min-w-0 flex-col gap-5">
          <p className="w-fit rounded-full bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent-foreground sm:text-sm">Shop local. Book local.</p>
          <h1 id="hero-title" className="max-w-2xl text-3xl font-extrabold leading-tight sm:text-5xl">
            Everything your town sells, in one place.
          </h1>
          <p className="max-w-xl text-base opacity-90 sm:text-lg">
            Groceries, fashion, electronics and fresh farm produce, plus trusted plumbers, tailors and other artisans near you. Pay safely and get it delivered to your door.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="accent" size="lg">
              <Link href="#catalogue">
                Start shopping <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/70 bg-transparent text-primary-foreground hover:bg-white/10 dark:border-border dark:text-foreground">
              <Link href="/search?kind=services">Book a service</Link>
            </Button>
          </div>
          <SearchForm id="q-hero" size="lg" className="hidden max-w-2xl text-foreground md:block" />
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {PROMISES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-1.5">
                <Icon className="size-4 shrink-0" aria-hidden /> {label}
              </li>
            ))}
          </ul>
        </div>

        {tiles.length > 0 && (
          <div className="min-w-0">
            <h2 className="sr-only">Popular right now</h2>
            {/* Phones and tablets: a swipeable row. */}
            <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 lg:hidden">
              {tiles.map((p, i) => (
                <li key={p.id} className="w-[72%] shrink-0 snap-start sm:w-[45%]">
                  <HeroTile p={p} big={i === 0} priority={i === 0} className="aspect-[4/3]" />
                </li>
              ))}
            </ul>
            {/* Desktop: one large photo and two small ones. */}
            <ul className="hidden h-[26rem] grid-cols-2 grid-rows-2 gap-3 lg:grid">
              {tiles.map((p, i) => (
                <li key={p.id} className={cn(i === 0 && "row-span-2", tiles.length === 1 && "col-span-2", tiles.length === 2 && "row-span-2")}>
                  <HeroTile p={p} big={i === 0} priority={i === 0} className="h-full" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
