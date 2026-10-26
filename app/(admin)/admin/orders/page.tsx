import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { adminOrderQueue, ORDER_TABS, type OrderTab } from "@/lib/admin/finance-view";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Orders & disputes" };

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const user = await requirePermission("dispute.manage", "/admin/orders");
  const sp = await searchParams;
  const tab: OrderTab = sp.tab && sp.tab in ORDER_TABS ? (sp.tab as OrderTab) : "disputes";
  const q = (sp.q ?? "").slice(0, 100);
  const { counts, rows } = await withRls({ scope: "admin", userId: user.id }, (tx) => adminOrderQueue(tx, tab, q));

  return (
    <>
      <PageHeader title="Orders & disputes" description="Decide disputes, step in on late refund requests and look up any order." />
      <form className="mb-4 flex max-w-xl gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Order number, email or customer name" aria-label="Search orders" />
        <Button type="submit" variant="outline">
          <Search aria-hidden /> Search
        </Button>
      </form>
      {!q && (
        <nav aria-label="Queues" className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {(Object.keys(ORDER_TABS) as OrderTab[]).map((t) => (
            <Link
              key={t}
              href={`/admin/orders?tab=${t}`}
              aria-current={t === tab ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-sm", t === tab ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
            >
              {ORDER_TABS[t]}
              {t !== "recent" && <span className="text-muted-foreground"> ({counts[t]})</span>}
            </Link>
          ))}
        </nav>
      )}
      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{q ? "No orders match." : "Nothing here."}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40">
                <div className="min-w-0">
                  <Link href={r.href} className="font-medium hover:underline">
                    {r.title}
                  </Link>
                  <p className="line-clamp-1 text-muted-foreground">{r.detail}</p>
                  <p className="text-xs text-muted-foreground">{r.at}</p>
                </div>
                <div className="flex items-center gap-3">
                  {r.amount && <span className="font-semibold tabular-nums">{r.amount}</span>}
                  <Badge variant={r.tone}>{r.badge}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
