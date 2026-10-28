import { CalendarClock, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DealEnds,
  formatDuration,
  servicePriceLabel,
} from "@/components/storefront/listing-cards";
import { QuestionsSection } from "@/components/listings/questions-section";
import { ReportListing } from "@/components/listings/report-listing";
import { ReviewList } from "@/components/reviews/review-list";
import { WishlistButton } from "@/components/storefront/wishlist-button";
import { isSaved } from "@/lib/wishlist";
import { BookService } from "@/components/storefront/book-service";
import { SellerCard } from "@/components/storefront/seller-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listingQuestions } from "@/lib/questions/questions";
import {
  getLgaNames,
  getListingReviews,
  getListingRules,
  getPublicService,
} from "@/lib/catalogue/storefront";
import { dealFor } from "@/lib/promotions/live";
import { minutesToTime, WEEKDAYS } from "@/lib/catalogue/units";
import { formatDateTime } from "@/lib/datetime";
import { formatPrice } from "@/lib/money";
import { publicImageUrl } from "@/lib/storage";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = await getPublicService((await params).slug);
  if (!s) return { title: "Service not found" };
  const description =
    s.metaDescription ??
    `${s.title} by ${s.business.name} in ${s.business.city}. Book on TownMart.`;
  return {
    title: s.metaTitle ?? s.title,
    description,
    alternates: { canonical: `/s/${s.slug}` },
    openGraph: {
      title: s.title,
      description,
      images: s.images[0]
        ? [
            {
              url: publicImageUrl(s.images[0].storageKey),
              alt: s.images[0].altText,
            },
          ]
        : undefined,
    },
  };
}

const LOCATION_TEXT = {
  on_site: "Comes to you",
  at_provider: "At the provider's location",
  both: "At your place or theirs",
} as const;

export default async function ServicePage({ params }: Props) {
  const s = await getPublicService((await params).slug);
  if (!s) notFound();
  const [lgas, reviews, viewer] = await Promise.all([getLgaNames(s.serviceLgaIds), getListingReviews({ serviceId: s.id }), getCurrentUser()]);
  const questions = await listingQuestions({ serviceId: s.id }, viewer?.id ?? null);
  const saved = await isSaved(viewer?.id, { serviceId: s.id });
  const now = new Date();
  const rules = await getListingRules([s.businessId]);
  const item = {
    kind: "service" as const,
    id: s.id,
    businessId: s.businessId,
    categoryId: s.categoryId,
    parentCategoryId: s.category.parentId,
  };
  const deal = dealFor(item, s.basePriceKobo, rules, now);

  // Group weekly windows by day for a compact schedule.
  const byDay = WEEKDAYS.map((day, weekday) => ({
    day,
    windows: s.availability.filter((a) => a.weekday === weekday),
  }));
  const [cover, ...rest] = s.images;

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8">
      <nav
        aria-label="Breadcrumb"
        className="mb-4 text-sm text-muted-foreground"
      >
        <Link href="/" className="hover:underline">
          Home
        </Link>{" "}
        /{" "}
        {s.category.parent && (
          <>
            <Link
              href={`/c/${s.category.parent.slug}`}
              className="hover:underline"
            >
              {s.category.parent.name}
            </Link>{" "}
            /{" "}
          </>
        )}
        <Link
          href={
            s.category.parent
              ? `/c/${s.category.parent.slug}/${s.category.slug}`
              : `/c/${s.category.slug}`
          }
          className="hover:underline"
        >
          {s.category.name}
        </Link>
      </nav>
      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-bold sm:text-3xl">{s.title}</h1>
            <WishlistButton target={{ serviceId: s.id }} saved={saved} signedIn={Boolean(viewer)} returnTo={`/s/${s.slug}`} />
          </div>
          {cover && (
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-muted">
              <Image
                src={publicImageUrl(cover.storageKey)}
                alt={cover.altText}
                fill
                priority
                sizes="(min-width: 1024px) 60vw, 100vw"
                className="object-cover"
              />
            </div>
          )}
          {s.descriptionHtml && (
            <div
              className="prose-tm text-sm"
              dangerouslySetInnerHTML={{ __html: s.descriptionHtml }}
            />
          )}
          {rest.length > 0 && (
            <section aria-labelledby="portfolio">
              <h2 id="portfolio" className="mb-3 text-lg font-bold">
                Portfolio
              </h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {rest.map((img) => (
                  <li
                    key={img.id}
                    className="relative aspect-square overflow-hidden rounded-xl bg-muted"
                  >
                    <Image
                      src={publicImageUrl(img.storageKey)}
                      alt={img.altText}
                      fill
                      sizes="(min-width: 640px) 20vw, 50vw"
                      className="object-cover"
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <p className="flex flex-wrap items-baseline gap-3">
                <span className="text-3xl font-extrabold">
                  {servicePriceLabel(
                    s.pricingModel,
                    deal ? deal.finalKobo : s.basePriceKobo,
                  )}
                </span>
                {deal && (
                  <>
                    <s className="text-muted-foreground">
                      {formatPrice(deal.originalKobo)}
                    </s>
                    <Badge variant={deal.isFlashDeal ? "danger" : "accent"}>
                      {deal.isFlashDeal ? "Flash deal: " : ""}Save{" "}
                      {formatPrice(deal.originalKobo - deal.finalKobo)}
                      {deal.percentOff >= 1 ? ` (${deal.percentOff}%)` : ""}
                    </Badge>
                  </>
                )}
              </p>
              {deal && (
                <DealEnds
                  deal={deal}
                  className="text-sm text-muted-foreground"
                />
              )}
              <p className="flex items-center gap-2 text-sm">
                <CalendarClock className="size-4 text-primary" aria-hidden />{" "}
                About {formatDuration(s.durationMinutes)}
              </p>
              <p className="flex items-center gap-2 text-sm">
                <MapPin className="size-4 text-primary" aria-hidden />{" "}
                {LOCATION_TEXT[s.locationMode]}
              </p>
              {s.depositPercent > 0 && (
                <p className="text-sm">
                  {s.depositPercent}% deposit when you book; you pay the rest
                  to the provider on the day.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                {s.requiresConfirmation
                  ? "The provider confirms each booking."
                  : "Bookings are confirmed instantly when a slot is free."}
              </p>
              <BookService
                serviceId={s.id}
                locationMode={s.locationMode}
                requiresPackage={s.pricingModel === "packages" && s.packages.length > 0}
                packages={s.packages.map((pkg) => {
                  const pkgDeal = dealFor(item, pkg.priceKobo, rules, now);
                  return {
                    id: pkg.id,
                    name: pkg.name,
                    price: formatPrice(pkgDeal ? pkgDeal.finalKobo : pkg.priceKobo),
                    duration: formatDuration(pkg.durationMinutes),
                  };
                })}
              />
            </CardContent>
          </Card>
          <SellerCard business={s.business} label="Provided by" />
          {s.packages.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Packages</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3">
                  {s.packages.map((pkg) => {
                    const pkgDeal = dealFor(item, pkg.priceKobo, rules, now);
                    return (
                      <li key={pkg.id} className="rounded-xl border p-3">
                        <p className="flex items-baseline justify-between gap-3">
                          <span className="font-semibold">{pkg.name}</span>
                          <span className="flex items-baseline gap-2">
                            {pkgDeal && (
                              <s className="text-xs text-muted-foreground">
                                {formatPrice(pkgDeal.originalKobo)}
                              </s>
                            )}
                            <span className="font-bold">
                              {formatPrice(
                                pkgDeal ? pkgDeal.finalKobo : pkg.priceKobo,
                              )}
                            </span>
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          About {formatDuration(pkg.durationMinutes)}
                        </p>
                        {pkg.description && (
                          <p className="mt-1 text-sm">{pkg.description}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Availability</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <table className="w-full">
                <caption className="sr-only">Weekly hours, Lagos time</caption>
                <tbody>
                  {byDay.map(({ day, windows }) => (
                    <tr key={day} className="border-b last:border-0">
                      <th
                        scope="row"
                        className="py-1.5 pr-3 text-left font-medium"
                      >
                        {day}
                      </th>
                      <td className="py-1.5 text-right">
                        {windows.length ? (
                          windows
                            .map(
                              (w) =>
                                `${minutesToTime(w.startMinute)}–${minutesToTime(w.endMinute)}`,
                            )
                            .join(", ")
                        ) : (
                          <span className="text-muted-foreground">Closed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {s.blackouts.length > 0 && (
                <div>
                  <p className="font-medium">Not available</p>
                  <ul className="text-muted-foreground">
                    {s.blackouts.map((b) => (
                      <li key={b.id}>
                        {formatDateTime(b.startsAt)} to{" "}
                        {formatDateTime(b.endsAt)}
                        {b.reason ? ` (${b.reason})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Service area</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {s.locationMode === "at_provider" ? (
                <p>
                  Based in {s.business.lga.name}, {s.business.state.name}.
                </p>
              ) : (
                <>
                  {lgas.length > 0 && (
                    <p>
                      {lgas
                        .map((l) => `${l.name} (${l.state.name})`)
                        .join(", ")}
                    </p>
                  )}
                  {s.radiusKm && (
                    <p className="mt-1">
                      Within {s.radiusKm} km of {s.business.city}.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <Card className="mt-10">
        <CardContent className="pt-6">
          <ReviewList avg={Number(s.ratingAvg)} total={reviews.total} breakdown={reviews.breakdown} reviews={reviews.reviews} signedIn={Boolean(viewer)} />
        </CardContent>
      </Card>

      <Card className="mt-10">
        <CardContent className="pt-6">
          <QuestionsSection kind="service" id={s.id} questions={questions} viewerId={viewer?.id ?? null} returnTo={`/s/${s.slug}`} />
        </CardContent>
      </Card>

      <div className="mt-6">
        <ReportListing kind="service" id={s.id} signedIn={Boolean(viewer)} returnTo={`/s/${s.slug}`} />
      </div>
    </main>
  );
}
