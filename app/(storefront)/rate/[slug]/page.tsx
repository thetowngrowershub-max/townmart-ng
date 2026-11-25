import { CheckCircle2, Star, Store } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Rating } from "@/components/storefront/rating";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getProviderReviews, getPublicStore } from "@/lib/catalogue/storefront";
import { withRls } from "@/lib/db";
import { waitingForReview } from "@/lib/reviews/reviews";
import { publicImageUrl } from "@/lib/storage";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const b = await getPublicStore((await params).slug);
  return { title: b ? `Rate ${b.name}` : "Provider not found", robots: { index: false } };
}

/**
 * "Rate my service": the link a provider shares with customers (WhatsApp, a
 * card, a sticker). It sends a signed-in customer straight to the rating form
 * for their finished bookings with this provider. Only real bookings can be
 * rated, so a provider can't collect ratings from people who never hired them.
 */
export default async function RateProviderPage({ params }: Props) {
  const { slug } = await params;
  const b = await getPublicStore(slug);
  if (!b) notFound();
  const [user, ratings] = await Promise.all([getCurrentUser(), getProviderReviews(b.id)]);
  const waiting = user ? await withRls({ userId: user.id }, (tx) => waitingForReview(tx, user.id, 20, { businessId: b.id, services: true })) : [];

  return (
    <main id="main" className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center gap-4">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl bg-muted">
          {b.logoKey ? (
            <Image src={publicImageUrl(b.logoKey)} alt={`${b.name} logo`} fill sizes="64px" className="object-cover" />
          ) : (
            <Store className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-accent-strong">Rate my service</p>
          <h1 className="text-2xl font-bold">How did {b.name} do?</h1>
          {ratings.total > 0 && <Rating avg={ratings.avg} count={ratings.total} />}
        </div>
      </div>

      {!user ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-6 text-sm">
            <p>Sign in with the account you booked with, and we&apos;ll take you to your finished jobs with {b.name}.</p>
            <Button asChild>
              <Link href={`/auth/sign-in?next=${encodeURIComponent(`/rate/${b.slug}`)}`}>
                <Star aria-hidden /> Sign in to rate
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : waiting.length > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">Pick the job you&apos;d like to rate.</p>
            <ul className="divide-y">
              {waiting.map((w) => (
                <li key={w.orderItemId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">{w.imageUrl && <Image src={w.imageUrl} alt="" fill sizes="48px" className="object-cover" />}</div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium">{w.title}</p>
                    <p className="text-muted-foreground">Order {w.orderNumber}</p>
                  </div>
                  <Button asChild size="sm">
                    <Link href={`/account/reviews/new?item=${w.orderItemId}`}>Rate my service</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-6 text-sm">
            <p className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span>
                There&apos;s no finished job with {b.name} on your account waiting for a rating. You may have rated them already, or the job hasn&apos;t been marked as done yet.
              </span>
            </p>
            <p className="text-muted-foreground">Only customers who booked through TownMart can rate a provider, so every rating comes from a real job.</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href={`/store/${b.slug}`}>See {b.name}&apos;s services</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/account/reviews">My reviews</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
