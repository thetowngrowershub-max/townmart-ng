import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Taken down" };

export default async function TakenDownPage() {
  const user = await requirePermission("moderation.manage", "/admin/moderation/taken-down");
  const rows = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const select = { id: true, title: true, takenDownAt: true, takenDownReason: true, business: { select: { name: true } } } as const;
    const where = { takenDownAt: { not: null } };
    const [p, s] = await Promise.all([tx.product.findMany({ where, select, take: 200 }), tx.service.findMany({ where, select, take: 200 })]);
    return [...p.map((x) => ({ ...x, kind: "product" as const })), ...s.map((x) => ({ ...x, kind: "service" as const }))].sort((a, b) => b.takenDownAt!.getTime() - a.takenDownAt!.getTime());
  });
  return (
    <>
      <PageHeader title="Taken down" description="Listings TownMart has hidden. Open one to restore it." />
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nothing is taken down.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/moderation/listings/${r.kind}/${r.id}`} className="flex flex-col gap-1 p-4 hover:bg-muted">
                    <span className="font-medium">{r.title}</span>
                    <span className="text-sm text-muted-foreground">
                      {r.business.name} · {formatDateTime(r.takenDownAt!)}
                    </span>
                    <span className="text-sm">{r.takenDownReason}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
