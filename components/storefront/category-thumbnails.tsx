import Image from "next/image";
import Link from "next/link";
import type { HomeCategory } from "@/lib/catalogue/home";
import { publicImageUrl } from "@/lib/storage";

/**
 * Category thumbnails, built from the category table (see getHomeCategories).
 * A swipeable row on phones, a grid that wraps for any number of categories
 * from sm up.
 */
export function CategoryThumbnails({ categories, headingId = "categories" }: { categories: HomeCategory[]; headingId?: string }) {
  if (categories.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id={headingId} className="text-2xl font-bold">
          Shop by category
        </h2>
        <Link href="/search" className="shrink-0 text-sm font-semibold text-primary underline">
          Browse all
        </Link>
      </div>
      <ul className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0">
        {categories.map((c) => (
          <li key={c.id} className="w-28 shrink-0 snap-start sm:w-auto">
            <Link href={`/c/${c.slug}`} className="group flex flex-col gap-2 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <span className="relative block aspect-square overflow-hidden rounded-2xl border bg-primary-soft transition-shadow group-hover:shadow-md group-hover:ring-2 group-hover:ring-accent">
                {c.coverKey ? (
                  <>
                    <Image src={publicImageUrl(c.coverKey)} alt="" fill sizes="(min-width: 640px) 160px, 112px" className="object-cover transition-transform duration-300 group-hover:scale-105" />
                    {c.icon && (
                      <span aria-hidden className="absolute bottom-1.5 left-1.5 grid size-8 place-items-center rounded-full bg-card/95 text-lg shadow-sm">
                        {c.icon}
                      </span>
                    )}
                  </>
                ) : (
                  <span aria-hidden className="absolute inset-0 grid place-items-center text-4xl">
                    {c.icon ?? "🛍️"}
                  </span>
                )}
              </span>
              <span className="px-0.5">
                <span className="line-clamp-2 text-sm font-semibold leading-tight">{c.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {c.count.toLocaleString("en-NG")} {c.kind === "product" ? (c.count === 1 ? "product" : "products") : c.count === 1 ? "service" : "services"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
