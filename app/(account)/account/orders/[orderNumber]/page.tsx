import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { OrderDetail } from "@/components/orders/order-detail";
import { PaymentStatus } from "@/components/orders/payment-status";
import { Alert } from "@/components/ui/alert";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { loadOrderConversations, loadOrderDetail } from "@/lib/orders/view";

export const metadata: Metadata = { title: "Order details" };

export default async function OrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;
  const user = await requirePermission("account.access", `/account/orders/${orderNumber}`);
  // Read as the shopper: RLS hides other people's orders, so they 404.
  const data = await withRls({ userId: user.id }, async (tx) => {
    const order = await loadOrderDetail(tx, { orderNumber });
    return order ? { order, conversations: await loadOrderConversations(tx, order) } : null;
  });
  if (!data) notFound();
  const { order, conversations } = data;

  return (
    <>
      <PageHeader title={`Order ${order.orderNumber}`} description={`Placed ${order.placedAt}`} />
      <div className="mb-6 flex flex-col gap-3">
        {order.status === "awaiting_payment" && (
          <>
            <Alert variant="warning">This order is waiting for payment. Your items are held until {order.paymentDueAt}.</Alert>
            <PaymentStatus orderNumber={order.orderNumber} token={null} canPay={order.canPay} failed={false} />
          </>
        )}
        {order.status === "cancelled" && <Alert variant="info">This order was cancelled. {order.cancelReason}</Alert>}
      </div>
      <OrderDetail order={order} conversations={conversations} />
    </>
  );
}
