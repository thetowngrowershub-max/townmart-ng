import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { ReplyForm } from "@/components/reviews/reply-form";
import { Stars } from "@/components/reviews/review-list";
import { Pagination } from "@/components/storefront/pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { can } from "@/lib/authz";
import { sellerReviews } from "@/lib/reviews/reviews";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reviews" };

const PAGE_SIZE = 20;

export default async function SellerReviewsPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  const ctx = await requireSellerPage("/dashboard/reviews", "review.manage");
  const sp = await searchParams;
  const unanswered = sp.show === "unanswered";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const data = await withSellerRls(ctx, (tx) => sellerReviews(tx, ctx.business.id, unanswered, page, PAGE_SIZE));
  const canReply = can(ctx.user, "review.manage", { businessId: ctx.business.id });

  return (
    <>
      <PageHeader
        title="Reviews"
        description={data.count > 0 ? `${data.avg.toFixed(1)} out of 5 from ${data.count} verified review${data.count === 1 ? "" : "s"}.` : "Reviews from customers who bought from you appear here."}
      />
      <nav aria-label="Review filters" className="mb-4 flex flex-wrap gap-2">
        {[
          { key: "all", label: "All", href: "/dashboard/reviews" },
          { key: "unanswered", label: `Not replied (${data.waiting})`, href: "/dashboard/reviews?show=unanswered" },
        ].map((f) => {
          const active = (f.key === "unanswered") === unanswered;
          return (
            <Link key={f.key} href={f.href} aria-current={active ? "page" : undefined} className={cn("rounded-full border px-3 py-1.5 text-sm", active ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}>
              {f.label}
            </Link>
          );
        })}
      </nav>
      {data.rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{unanswered ? "You've replied to every review." : "No reviews yet."}</Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.rows.map((r) => (
            <li key={r.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 pt-6 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars rating={r.rating} />
                    <span className="font-medium">{r.author}</span>
                    <span className="text-xs text-muted-foreground">
                      on{" "}
                      <Link href={r.href} className="underline">
                        {r.title}
                      </Link>{" "}
                      · {r.date}
                    </span>
                    {r.reported && <Badge variant="warning">Reported</Badge>}
                    {r.hidden && <Badge variant="secondary">Hidden by TownMart</Badge>}
                  </div>
                  <p className="whitespace-pre-wrap">{r.body}</p>
                  {r.images.length > 0 && <p className="text-xs text-muted-foreground">{r.images.length} photo{r.images.length === 1 ? "" : "s"}</p>}
                  {r.reply && (
                    <div className="ml-4 rounded-xl bg-muted p-3">
                      <p className="text-xs font-medium text-muted-foreground">Your reply · {r.reply.date}</p>
                      <p className="whitespace-pre-wrap">{r.reply.body}</p>
                    </div>
                  )}
                  {canReply && <ReplyForm reviewId={r.id} current={r.reply?.body ?? null} />}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} href={(n) => `/dashboard/reviews?${unanswered ? "show=unanswered&" : ""}page=${n}`} />
    </>
  );
}
