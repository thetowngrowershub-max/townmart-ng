import type { Metadata } from "next";
import { QuestionDecision } from "@/components/moderation/moderation-controls";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Question moderation" };

export default async function QuestionModerationPage() {
  const user = await requirePermission("moderation.manage", "/admin/moderation/questions");
  const rows = await withRls({ scope: "admin", userId: user.id }, (tx) =>
    tx.listingQuestion.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, question: true, answer: true, askerName: true, status: true, createdAt: true, answeredAt: true, business: { select: { name: true } }, product: { select: { title: true } }, service: { select: { title: true } } },
    }),
  );
  return (
    <>
      <PageHeader title="Questions" description="The latest questions shoppers asked on listings. Answered questions are public; hide anything abusive or off-topic." />
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No questions yet.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((q) => (
                <li key={q.id} className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{q.product?.title ?? q.service?.title}</span>
                    <span className="text-muted-foreground">· {q.business.name}</span>
                    {q.status === "hidden" ? <Badge variant="danger">Hidden</Badge> : q.answer ? <Badge variant="secondary">Answered</Badge> : <Badge variant="accent">Waiting for the seller</Badge>}
                  </div>
                  <p className="text-sm">
                    <span className="font-medium">Q:</span> {q.question} <span className="text-muted-foreground">· {q.askerName}, {formatDateTime(q.createdAt)}</span>
                  </p>
                  {q.answer && (
                    <p className="text-sm">
                      <span className="font-medium">A:</span> {q.answer}
                    </p>
                  )}
                  <QuestionDecision id={q.id} hidden={q.status === "hidden"} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
