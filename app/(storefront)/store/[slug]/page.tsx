import { MapPin, Star, Store } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JobPhotos } from "@/components/portfolio/job-photos";
import { ReviewList } from "@/components/reviews/review-list";
import { CardGrid, ProductCard, ServiceCard } from "@/components/storefront/listing-cards";
import { Rating } from "@/components/storefront/rating";
import { PolicySummary } from "@/components/storefront/seller-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPortfolio, getProviderReviews, getPublicStore } from "@/lib/catalogue/storefront";
import { describeWeek, openState, parseOpeningHours } from "@/lib/catalogue/opening-hours";
import { formatDate } from "@/lib/datetime";
import { searchProvider } from "@/lib/search";
import { publicImageUrl } from "@/lib/storage";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const b = await getPublicStore((await params).slug);
  if (!b) return { title: "Store not found" };
  const description = b.description?.slice(0, 160) ?? `${b.name} in ${b.city}, ${b.state.name} on TownMart.`;
  return {
    title: b.name,
    description,
    alternates: { canonical: `/store/${b.slug}` },
    openGraph: { title: b.name, description, images: b.bannerKey ? [{ url: publicImageUrl(b.bannerKey) }] : undefined },
  };
}

export default async function StorePage({ params }: Props) {
  const b = await getPublicStore((await params).slug);
  if (!b) notFound();
  // The store's own listings, newest first, via the public search path.
  const [results, photos, ratings, viewer] = await Promise.all([
    searchProvider().search({ kind: "all", businessId: b.id, sort: "newest", page: 1, pageSize: 48 }),
    getPortfolio(b.id),
    getProviderReviews(b.id),
    getCurrentUser(),
  ]);
  // Anyone who offers services gets the "Rate my service" section, even before their first rating.
  const offersServices = results.services.total > 0 || ratings.total > 0;
  const isFoodSeller = b.type === "restaurant" || b.type === "confectioner";
  const hours = parseOpeningHours(b.policy?.openingHours);
  const kitchen = hours || b.policy?.ordersPaused ? openState(hours, b.policy?.ordersPaused ?? false) : null;

  return (
    <main id="main">
      <div className="relative h-40 bg-primary-soft sm:h-56">
        {b.bannerKey && <Image src={publicImageUrl(b.bannerKey)} alt="" fill priority sizes="100vw" className="object-cover" />}
      </div>
      <div className="mx-auto max-w-7xl px-4">
        <div className="relative -mt-10 flex flex-wrap items-end gap-4">
          <div className="relative size-24 overflow-hidden rounded-2xl border-4 border-background bg-muted">
            {b.logoKey ? (
              <Image src={publicImageUrl(b.logoKey)} alt={`${b.name} logo`} fill sizes="96px" className="object-cover" />
            ) : (
              <Store className="absolute top-1/2 left-1/2 size-8 -translate-1/2 text-muted-foreground" aria-hidden />
            )}
          </div>
          <div className="pb-1">
            <h1 className="text-2xl font-bold sm:text-3xl">{b.name}</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="size-4" aria-hidden /> {b.city}, {b.lga.name}, {b.state.name}
              <span aria-hidden>·</span>
              <span className="capitalize">{b.type.replace("_", " ")}</span>
              <span aria-hidden>·</span> Since {formatDate(b.createdAt)}
            </p>
            <Rating avg={Number(b.ratingAvg)} count={b.ratingCount} />
            {kitchen && (
              <p role="status" className={kitchen.open ? "mt-1 text-sm font-semibold text-primary" : "mt-1 text-sm font-semibold text-warning"}>
                {kitchen.label}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-8 py-8 lg:grid-cols-[1fr_300px]">
          <div className="flex min-w-0 flex-col gap-10">
            {results.products.total > 0 && (
              <section aria-labelledby="store-products">
                <h2 id="store-products" className="mb-4 text-xl font-bold">
                  {isFoodSeller ? "Menu" : "Products"} ({results.products.total})
                </h2>
                <CardGrid>
                  {results.products.items.map((p) => (
                    <ProductCard key={p.id} p={p} />
                  ))}
                </CardGrid>
              </section>
            )}
            {results.services.total > 0 && (
              <section aria-labelledby="store-services">
                <h2 id="store-services" className="mb-4 text-xl font-bold">
                  Services ({results.services.total})
                </h2>
                <CardGrid>
                  {results.services.items.map((s) => (
                    <ServiceCard key={s.id} s={s} />
                  ))}
                </CardGrid>
              </section>
            )}
            {photos.length > 0 && (
              <section id="jobs" aria-labelledby="store-jobs" className="scroll-mt-24">
                <h2 id="store-jobs" className="mb-1 text-xl font-bold">
                  Jobs done ({photos.length})
                </h2>
                <p className="mb-4 text-sm text-muted-foreground">Photos of past work, shared by {b.name}.</p>
                <JobPhotos photos={photos} />
              </section>
            )}
            {offersServices && (
              <ReviewList
                title="Rate my service"
                avg={ratings.avg}
                total={ratings.total}
                breakdown={ratings.breakdown}
                reviews={ratings.reviews}
                signedIn={Boolean(viewer)}
                verifiedLabel="Booked on TownMart"
                emptyText={`No ratings yet. Customers who book ${b.name} through TownMart can rate their service once the job is done.`}
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/rate/${b.slug}`}>
                      <Star aria-hidden /> Rate {b.name}
                    </Link>
                  </Button>
                }
              />
            )}
            {results.products.total + results.services.total === 0 && <p className="text-muted-foreground">This store hasn&apos;t listed anything yet.</p>}
          </div>
          <aside className="flex flex-col gap-4">
            {b.description && (
              <Card>
                <CardHeader>
                  <CardTitle>About</CardTitle>
                </CardHeader>
                <CardContent className="text-sm whitespace-pre-line">{b.description}</CardContent>
              </Card>
            )}
            {hours && (
              <Card>
                <CardHeader>
                  <CardTitle>Opening hours</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="flex flex-col gap-1 text-sm">
                    {describeWeek(hours).map(([day, time]) => (
                      <div key={day} className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">{day}</dt>
                        <dd className="font-medium">{time}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Policies</CardTitle>
              </CardHeader>
              <CardContent>
                <PolicySummary policy={b.policy} />
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  );
}
