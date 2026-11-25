import type { Metadata } from "next";
import Link from "next/link";
import { AnswerForm } from "@/components/listings/answer-form";
import { PageHeader } from "@/components/layout/app-shell";
import { Pagination } from "@/components/storefront/pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/datetime";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Questions" };

const PAGE_SIZE = 20;

export default async function SellerQuestionsPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  const ctx = await requireSellerPage("/dashboard/questions", "question.answer");
  const sp = await searchParams;
  const all = sp.show === "all";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const businessId = ctx.business.id;

  const { rows, total, waiting } = await withSellerRls(ctx, async (tx) => {
    const where = { businessId, ...(all ? {} : { answer: null }) };
    const [rows, total, waiting] = await Promise.all([
      tx.listingQuestion.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: { id: true, question: true, answer: true, askerName: true, status: true, createdAt: true, answeredAt: true, product: { select: { title: true, slug: true } }, service: { select: { title: true, slug: true } } },
      }),
      tx.listingQuestion.count({ where }),
      tx.listingQuestion.count({ where: { businessId, answer: null } }),
    ]);
    return { rows, total, waiting };
  });

  return (
    <>
      <PageHeader title="Questions" description="Shoppers ask about your listings here. Your answer appears on the listing for everyone." />
      <nav aria-label="Question filters" className="mb-4 flex flex-wrap gap-2">
        {[
          { key: "waiting", label: `Waiting (${waiting})`, href: "/dashboard/questions" },
          { key: "all", label: "All", href: "/dashboard/questions?show=all" },
        ].map((f) => {
          const active = (f.key === "all") === all;
          return (
            <Link key={f.key} href={f.href} aria-current={active ? "page" : undefined} className={cn("rounded-full border px-3 py-1.5 text-sm", active ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}>
              {f.label}
            </Link>
          );
        })}
      </nav>
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{all ? "No questions yet." : "You've answered every question."}</Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((q) => {
            const listing = q.product ? { title: q.product.title, href: `/p/${q.product.slug}` } : q.service ? { title: q.service.title, href: `/s/${q.service.slug}` } : null;
            return (
              <li key={q.id}>
                <Card>
                  <CardContent className="flex flex-col gap-2 pt-6 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{q.askerName}</span>
                      <span className="text-xs text-muted-foreground">
                        {listing && (
                          <>
                            on{" "}
                            <Link href={listing.href} className="underline">
                              {listing.title}
                            </Link>{" "}
                            ·{" "}
                          </>
                        )}
                        {formatDateTime(q.createdAt)}
                      </span>
                      {q.status === "hidden" && <Badge variant="secondary">Hidden by TownMart</Badge>}
                      {!q.answer && <Badge variant="warning">Waiting for you</Badge>}
                    </div>
                    <p className="whitespace-pre-wrap font-medium">{q.question}</p>
                    {q.answer && (
                      <div className="ml-4 rounded-xl bg-muted p-3">
                        <p className="text-xs font-medium text-muted-foreground">Your answer{q.answeredAt ? ` · ${formatDateTime(q.answeredAt)}` : ""}</p>
                        <p className="whitespace-pre-wrap">{q.answer}</p>
                      </div>
                    )}
                    {q.status !== "hidden" && <AnswerForm questionId={q.id} current={q.answer} />}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} href={(n) => `/dashboard/questions?${all ? "show=all&" : ""}page=${n}`} />
    </>
  );
}
