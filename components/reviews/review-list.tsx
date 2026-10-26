import { Star } from "lucide-react";
import Image from "next/image";
import type { ReviewView } from "@/lib/reviews/reviews";
import { ReportReview } from "./report-review";

export function Stars({ rating, className = "size-4" }: { rating: number; className?: string }) {
  return (
    <span className="inline-flex" aria-label={`${rating} out of 5 stars`} role="img">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`${className} ${n <= rating ? "fill-accent text-accent" : "text-muted-foreground/30"}`} aria-hidden />
      ))}
    </span>
  );
}

/** A listing's reviews: average, star breakdown and the latest reviews, each with any seller reply. */
export function ReviewList({ avg, total, breakdown, reviews, signedIn }: { avg: number; total: number; breakdown: number[]; reviews: ReviewView[]; signedIn: boolean }) {
  return (
    <section id="reviews" aria-labelledby="reviews-title" className="flex flex-col gap-4">
      <h2 id="reviews-title" className="text-lg font-bold">
        Reviews
      </h2>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">No reviews yet. Only customers who bought this through TownMart can review it.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="font-heading text-4xl font-bold">{avg.toFixed(1)}</p>
              <Stars rating={Math.round(avg)} />
              <p className="text-xs text-muted-foreground">
                {total} verified review{total === 1 ? "" : "s"}
              </p>
            </div>
            <dl className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
              {breakdown.map((n, i) => (
                <div key={i} className="flex items-center gap-2">
                  <dt className="w-10">{5 - i} star</dt>
                  <dd className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full bg-accent" style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
                  </dd>
                  <dd className="w-6 text-right tabular-nums text-muted-foreground">{n}</dd>
                </div>
              ))}
            </dl>
          </div>
          <ul className="flex flex-col divide-y">
            {reviews.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Stars rating={r.rating} />
                  <span className="font-medium">{r.author}</span>
                  <span className="text-xs text-muted-foreground">· Verified purchase · {r.date}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{r.body}</p>
                {r.images.length > 0 && (
                  <ul className="flex gap-2">
                    {r.images.map((src) => (
                      <li key={src} className="relative size-20 overflow-hidden rounded-lg bg-muted">
                        <a href={src} target="_blank" rel="noreferrer">
                          <Image src={src} alt={`Photo from ${r.author}`} fill sizes="80px" className="object-cover" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {r.reply && (
                  <div className="ml-4 rounded-xl bg-muted p-3 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">Reply from the seller · {r.reply.date}</p>
                    <p className="whitespace-pre-wrap">{r.reply.body}</p>
                  </div>
                )}
                {signedIn && !r.reported && <ReportReview reviewId={r.id} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
