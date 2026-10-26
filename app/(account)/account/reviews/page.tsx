import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Stars } from "@/components/reviews/review-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { myReviews, waitingForReview } from "@/lib/reviews/reviews";

export const metadata: Metadata = { title: "My reviews" };

export default async function MyReviewsPage() {
  const user = await requirePermission("account.access", "/account/reviews");
  const { waiting, mine } = await withRls({ userId: user.id }, async (tx) => ({ waiting: await waitingForReview(tx, user.id), mine: await myReviews(tx, user.id) }));

  return (
    <>
      <PageHeader title="Reviews" description="Only things you bought or booked through TownMart can be reviewed." />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Waiting for your review</CardTitle>
          </CardHeader>
          <CardContent>
            {waiting.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to review right now. Items show here once they&apos;re delivered or done.</p>
            ) : (
              <ul className="divide-y">
                {waiting.map((w) => (
                  <li key={w.orderItemId} className="flex items-center gap-3 py-3 first:pt-0">
                    <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">{w.imageUrl && <Image src={w.imageUrl} alt="" fill sizes="48px" className="object-cover" />}</div>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="truncate font-medium">{w.title}</p>
                      <p className="text-muted-foreground">
                        {w.businessName} · {w.orderNumber}
                      </p>
                    </div>
                    <Button asChild size="sm">
                      <Link href={`/account/reviews/new?item=${w.orderItemId}`}>Write a review</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Your reviews</CardTitle>
          </CardHeader>
          <CardContent>
            {mine.length === 0 ? (
              <p className="text-sm text-muted-foreground">You haven&apos;t written any reviews yet.</p>
            ) : (
              <ul className="divide-y">
                {mine.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={r.href} className="font-medium hover:underline">
                        {r.title}
                      </Link>
                      <Stars rating={r.rating} />
                      <span className="text-xs text-muted-foreground">{r.date}</span>
                      {r.hidden && <Badge variant="warning">Hidden by TownMart</Badge>}
                    </div>
                    <p className="whitespace-pre-wrap text-muted-foreground">{r.body}</p>
                    {r.reply && (
                      <p className="ml-4 rounded-lg bg-muted p-2">
                        <span className="text-xs font-medium">Seller reply: </span>
                        {r.reply.body}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
