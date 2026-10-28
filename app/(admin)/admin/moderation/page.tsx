import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { reportQueue } from "@/lib/moderation/core";
import { REPORT_REASON_LABELS } from "@/lib/moderation/labels";

export const metadata: Metadata = { title: "Moderation" };

export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("moderation.manage", "/admin/moderation");
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const { queue, found } = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const queue = await reportQueue(tx);
    if (q.length < 2) return { queue, found: null };
    const where = { title: { contains: q, mode: "insensitive" as const }, deletedAt: null };
    const select = { id: true, title: true, status: true, takenDownAt: true, business: { select: { name: true } } } as const;
    const [products, services] = await Promise.all([
      tx.product.findMany({ where, select, take: 20, orderBy: { updatedAt: "desc" } }),
      tx.service.findMany({ where, select, take: 20, orderBy: { updatedAt: "desc" } }),
    ]);
    return { queue, found: [...products.map((p) => ({ ...p, kind: "product" as const })), ...services.map((s) => ({ ...s, kind: "service" as const }))] };
  });

  return (
    <>
      <PageHeader title="Reported listings" description="Listings shoppers reported, or that matched a prohibited-items keyword. Most-reported first." />
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="p-0">
            {queue.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No open reports.</p>
            ) : (
              <ul className="divide-y">
                {queue.map((r) => (
                  <li key={r.listing.id}>
                    <Link href={`/admin/moderation/listings/${r.listing.kind}/${r.listing.id}`} className="flex flex-wrap items-start justify-between gap-3 p-4 hover:bg-muted">
                      <div className="min-w-0">
                        <p className="font-medium">{r.listing.title}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {r.listing.business.name} · {r.listing.kind === "product" ? "Product" : "Service"} · first reported {formatDateTime(r.firstAt)}
                        </p>
                        <p className="mt-1 flex flex-wrap gap-1">
                          {r.reasons.map((reason) => (
                            <Badge key={reason} variant={reason === "keyword_match" ? "accent" : "secondary"}>
                              {REPORT_REASON_LABELS[reason]}
                            </Badge>
                          ))}
                        </p>
                      </div>
                      <Badge variant={r.reports > 2 ? "danger" : "secondary"}>
                        {r.reports} report{r.reports === 1 ? "" : "s"}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Find any listing</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form className="flex gap-2" action="/admin/moderation">
              <Input name="q" defaultValue={q} placeholder="Search products and services by title" aria-label="Search listings" />
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
            {found && (found.length === 0 ? (
              <p className="text-sm text-muted-foreground">No listings match “{q}”.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {found.map((l) => (
                  <li key={l.id}>
                    <Link href={`/admin/moderation/listings/${l.kind}/${l.id}`} className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-muted">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{l.title}</span> <span className="text-muted-foreground">· {l.business.name}</span>
                      </span>
                      {l.takenDownAt ? <Badge variant="danger">Taken down</Badge> : <Badge variant="secondary">{l.status}</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
