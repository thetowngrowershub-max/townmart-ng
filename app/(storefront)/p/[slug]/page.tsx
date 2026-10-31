import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QuestionsSection } from "@/components/listings/questions-section";
import { ReportListing } from "@/components/listings/report-listing";
import { ReviewList } from "@/components/reviews/review-list";
import { WishlistButton } from "@/components/storefront/wishlist-button";
import { isSaved } from "@/lib/wishlist";
import { CardGrid, ProductCard } from "@/components/storefront/listing-cards";
import { ProductPurchase, type VariantView } from "@/components/storefront/product-purchase";
import { PolicySummary, SellerCard } from "@/components/storefront/seller-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listingQuestions } from "@/lib/questions/questions";
import { getListingReviews, getListingRules, getProductSpecs, getPublicProduct, getRelatedProducts } from "@/lib/catalogue/storefront";
import { formatDateTime } from "@/lib/datetime";
import { dealFor } from "@/lib/promotions/live";
import { unitLabel } from "@/lib/catalogue/units";
import { env } from "@/lib/env";
import { koboToNairaString } from "@/lib/money";
import { publicImageUrl } from "@/lib/storage";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getPublicProduct((await params).slug);
  if (!p) return { title: "Product not found" };
  const description = p.metaDescription ?? `${p.title} from ${p.business.name}, ${p.business.city}. Buy on TownMart.`;
  const cover = p.images[0];
  return {
    title: p.metaTitle ?? p.title,
    description,
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: { title: p.title, description, type: "website", images: cover ? [{ url: publicImageUrl(cover.storageKey), alt: cover.altText }] : undefined },
  };
}

export default async function ProductPage({ params }: Props) {
  const p = await getPublicProduct((await params).slug);
  if (!p) notFound();
  const [related, reviews, viewer] = await Promise.all([getRelatedProducts(p.id, p.categoryId), getListingReviews({ productId: p.id }), getCurrentUser()]);
  const [questions, specs] = await Promise.all([listingQuestions({ productId: p.id }, viewer?.id ?? null), getProductSpecs(p.categoryId, p.attributes)]);
  const saved = await isSaved(viewer?.id, { productId: p.id });
  const now = new Date();
  const rules = await getListingRules([p.businessId, ...related.map((r) => r.businessId)]);
  const item = { kind: "product" as const, id: p.id, businessId: p.businessId, categoryId: p.categoryId, parentCategoryId: p.category.parentId };

  const images = p.images.map((i) => ({ url: publicImageUrl(i.storageKey), alt: i.altText, width: i.width, height: i.height }));
  const variants: VariantView[] = p.variants.map((v) => {
    const qty = v.stockQty;
    const state: VariantView["stock"]["state"] = !p.trackInventory
      ? "in"
      : qty.lte(0)
        ? p.allowBackorder
          ? "backorder"
          : "out"
        : qty.lte(v.lowStockThreshold)
          ? "low"
          : "in";
    const imgIdx = p.images.findIndex((i) => i.variantId === v.id);
    const deal = dealFor(item, v.priceKobo, rules, now);
    return {
      id: v.id,
      optionValues: (v.optionValues ?? {}) as Record<string, string>,
      priceKobo: (deal?.finalKobo ?? v.priceKobo).toString(),
      deal: deal
        ? {
            originalKobo: deal.originalKobo.toString(),
            percentOff: deal.percentOff,
            name: deal.promotionName,
            isFlashDeal: deal.isFlashDeal,
            endsLabel: formatDateTime(deal.endsAt),
          }
        : null,
      compareAtPriceKobo: v.compareAtPriceKobo?.toString() ?? null,
      stock: { state, qty: state === "low" ? qty.toString() : undefined },
      imageIndex: imgIdx >= 0 ? imgIdx : null,
    };
  });
  const inStock = variants.some((v) => v.stock.state !== "out");
  const appUrl = env().APP_URL;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    image: images.map((i) => new URL(i.url, appUrl).toString()),
    brand: p.brand ? { "@type": "Brand", name: p.brand } : undefined,
    sku: p.variants[0]?.sku,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "NGN",
      // The prices a shopper actually pays today, promotions included.
      lowPrice: koboToNairaString(variants.reduce((m, v) => (BigInt(v.priceKobo) < m ? BigInt(v.priceKobo) : m), BigInt(variants[0]?.priceKobo ?? p.basePriceKobo))),
      highPrice: koboToNairaString(variants.reduce((m, v) => (BigInt(v.priceKobo) > m ? BigInt(v.priceKobo) : m), BigInt(variants[0]?.priceKobo ?? p.basePriceKobo))),
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: p.business.name },
    },
    aggregateRating: p.ratingCount > 0 ? { "@type": "AggregateRating", ratingValue: Number(p.ratingAvg), reviewCount: p.ratingCount } : undefined,
  };
  const crumbs = [p.category.parent, { name: p.category.name, slug: p.category.slug }].filter(Boolean) as { name: string; slug: string }[];

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href="/" className="hover:underline">
              Home
            </Link>
          </li>
          {crumbs.map((c, i) => (
            <li key={c.slug}>
              /{" "}
              <Link href={i === 0 && crumbs.length > 1 ? `/c/${c.slug}` : crumbs.length > 1 ? `/c/${crumbs[0]!.slug}/${c.slug}` : `/c/${c.slug}`} className="hover:underline">
                {c.name}
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      <ProductPurchase
        title={p.title}
        images={images}
        options={p.options.map((o) => ({ name: o.name, values: o.values }))}
        variants={variants}
        unitLabel={unitLabel(p.unit)}
        minOrder={p.minOrderQty.toString()}
        fractional={p.allowFractionalQty}
      >
        {p.isPerishable && <p className="text-sm">Perishable{p.shelfLifeNote ? `: ${p.shelfLifeNote}` : "."}</p>}
        <WishlistButton target={{ productId: p.id }} saved={saved} signedIn={Boolean(viewer)} returnTo={`/p/${p.slug}`} />
        <SellerCard business={p.business} />
        <PolicySummary policy={p.business.policy} />
      </ProductPurchase>

      {specs.length > 0 && (
        <Card className="mt-10">
          <CardHeader>
            <CardTitle as="h2">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid max-w-3xl gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {specs.map((s) => (
                <div key={s.name} className="flex justify-between gap-4 border-b py-1.5">
                  <dt className="text-muted-foreground">{s.name}</dt>
                  <dd className="text-right font-medium">{s.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {p.descriptionHtml && (
        <Card className="mt-10">
          <CardHeader>
            <CardTitle as="h2">Description</CardTitle>
          </CardHeader>
          {/* Sanitised with an allowlist when saved (lib/sanitize.ts). */}
          <CardContent className="prose-tm max-w-3xl text-sm" dangerouslySetInnerHTML={{ __html: p.descriptionHtml }} />
        </Card>
      )}

      <Card className="mt-10">
        <CardContent className="pt-6">
          <ReviewList avg={Number(p.ratingAvg)} total={reviews.total} breakdown={reviews.breakdown} reviews={reviews.reviews} signedIn={Boolean(viewer)} />
        </CardContent>
      </Card>

      <Card className="mt-10">
        <CardContent className="pt-6">
          <QuestionsSection kind="product" id={p.id} questions={questions} viewerId={viewer?.id ?? null} returnTo={`/p/${p.slug}`} />
        </CardContent>
      </Card>

      <div className="mt-6">
        <ReportListing kind="product" id={p.id} signedIn={Boolean(viewer)} returnTo={`/p/${p.slug}`} />
      </div>

      {related.length > 0 && (
        <section aria-labelledby="related" className="mt-12">
          <h2 id="related" className="mb-4 text-xl font-bold">
            More in {p.category.name}
          </h2>
          <CardGrid>
            {related.map((r) => (
              <ProductCard
                key={r.id}
                p={{
                  id: r.id,
                  slug: r.slug,
                  title: r.title,
                  priceKobo: r.basePriceKobo,
                  compareAtPriceKobo: r.compareAtPriceKobo,
                  unit: r.unit,
                  coverKey: r.images[0]?.storageKey ?? null,
                  coverAlt: r.images[0]?.altText ?? null,
                  ratingAvg: Number(r.ratingAvg),
                  ratingCount: r.ratingCount,
                  inStock: !r.trackInventory || r.allowBackorder || r.variants.some((v) => v.stockQty.gt(0)),
                  deal: dealFor({ kind: "product", id: r.id, businessId: r.businessId, categoryId: r.categoryId, parentCategoryId: r.category.parentId }, r.basePriceKobo, rules, now),
                  business: { name: r.business.name, slug: r.business.slug, city: r.business.city, stateName: r.business.state.name },
                }}
              />
            ))}
          </CardGrid>
        </section>
      )}
    </main>
  );
}
