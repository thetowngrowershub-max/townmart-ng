import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { sellerInbox } from "@/lib/fulfilment/messages";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Messages" };

export default async function SellerMessagesPage() {
  const ctx = await requireSellerPage("/dashboard/messages", "order.read");
  const rows = await withSellerRls(ctx, (tx) => sellerInbox(tx, ctx.business.id));

  return (
    <>
      <PageHeader title="Messages" description="Conversations with customers, one per order. Keep them about the order: phone numbers and payments stay on TownMart." />
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No messages yet. Customers can message you from their order page.</Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.sellerOrderId}>
                <Link href={`/dashboard/orders/${r.sellerOrderId}#messages`} className={cn("flex items-start gap-3 p-4 hover:bg-muted/50", r.unread > 0 && "bg-primary-soft/40")}>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={cn(r.unread > 0 && "font-semibold")}>{r.customer}</span>
                      <span className="font-mono text-xs text-muted-foreground">{r.orderNumber}</span>
                    </p>
                    <p className="truncate text-muted-foreground">
                      {r.lastFrom === "seller" && "You: "}
                      {r.last}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                    <span>{r.at}</span>
                    {r.unread > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 font-bold text-primary-foreground">{r.unread}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
