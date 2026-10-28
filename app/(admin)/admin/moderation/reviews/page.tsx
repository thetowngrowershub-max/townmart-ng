import type { Metadata } from "next";
import { ReviewDecision } from "@/components/moderation/moderation-controls";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Review moderation" };

export default async function ReviewModerationPage() {
  const user = await requirePermission("moderation.manage", "/admin/moderation/reviews");
  const { reported, hidden } = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const select = {
      id: true,
      rating: true,
      body: true,
      authorName: true,
      status: true,
      reportReason: true,
      reportedAt: true,
      createdAt: true,
      sellerReply: true,
      business: { select: { name: true } },
      product: { select: { title: true } },
      service: { select: { title: true } },
    } as const;
    const [reported, hidden] = await Promise.all([
      tx.review.findMany({ where: { status: "reported" }, select, orderBy: { reportedAt: "asc" }, take: 100 }),
      tx.review.findMany({ where: { status: "hidden" }, select, orderBy: { updatedAt: "desc" }, take: 30 }),
    ]);
    return { reported, hidden };
  });

  const list = (rows: typeof reported, empty: string) =>
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">{empty}</p>
    ) : (
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 py-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{r.product?.title ?? r.service?.title}</span>
              <span className="text-muted-foreground">· {r.business.name}</span>
              <Badge variant="secondary">{r.rating}/5</Badge>
            </div>
            <p className="text-sm whitespace-pre-line">“{r.body}”</p>
            <p className="text-xs text-muted-foreground">
              {r.authorName} · {formatDateTime(r.createdAt)}
            </p>
            {r.sellerReply && <p className="text-sm text-muted-foreground">Seller reply: {r.sellerReply}</p>}
            {r.reportReason && (
              <p className="text-sm">
                <span className="font-medium">Reported{r.reportedAt ? ` ${formatDateTime(r.reportedAt)}` : ""}:</span> {r.reportReason.replace(/ \(reported by [0-9a-f-]+\)$/, "")}
              </p>
            )}
            <ReviewDecision id={r.id} hidden={r.status === "hidden"} />
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader title="Reviews" description="Reported reviews stay visible until you decide. Hiding one removes it from ratings too." />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Reported ({reported.length})</CardTitle>
          </CardHeader>
          <CardContent>{list(reported, "No reported reviews.")}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recently hidden</CardTitle>
          </CardHeader>
          <CardContent>{list(hidden, "No hidden reviews.")}</CardContent>
        </Card>
      </div>
    </>
  );
}
