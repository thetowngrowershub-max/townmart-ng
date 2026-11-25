import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/orders/order-detail";
import { PaymentStatus } from "@/components/orders/payment-status";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withSystemContext } from "@/lib/db";
import { findViewableOrder } from "@/lib/orders/access";
import { loadOrderConversations, loadOrderDetail } from "@/lib/orders/view";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default async function OrderComplete({ params, searchParams }: { params: Promise<{ orderNumber: string }>; searchParams: Promise<{ t?: string; payment?: string }> }) {
  const { orderNumber } = await params;
  const { t, payment } = await searchParams;
  const found = await findViewableOrder(orderNumber, t);
  if (!found) notFound();
  // The link (or ownership) was checked above; the order is read in the system scope so guests can see it.
  const { order, conversations } = await withSystemContext(async (tx) => {
    const order = (await loadOrderDetail(tx, { id: found.id }))!;
    return { order, conversations: await loadOrderConversations(tx, order) };
  });
  const user = await getCurrentUser();

  const heading =
    order.status === "confirmed"
      ? { icon: <CheckCircle2 className="size-10 text-success" aria-hidden />, title: order.payOnDelivery ? "Order placed" : "Thank you! Your order is confirmed", body: order.payOnDelivery ? `Pay ${order.totals.total} when your order arrives.` : `We've received your payment of ${order.totals.total}.` }
      : order.status === "awaiting_payment"
        ? { icon: <Clock className="size-10 text-warning" aria-hidden />, title: "Waiting for your payment", body: `Your items are held until ${order.paymentDueAt}.` }
        : { icon: <XCircle className="size-10 text-muted-foreground" aria-hidden />, title: "This order was cancelled", body: order.cancelReason ?? "" };

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8 flex flex-col items-start gap-3">
        {heading.icon}
        <h1 className="text-3xl font-bold">{heading.title}</h1>
        <p className="text-muted-foreground">
          Order <span className="font-semibold text-foreground">{order.orderNumber}</span> · placed {order.placedAt}. {heading.body}
        </p>
        {order.status === "awaiting_payment" && <PaymentStatus orderNumber={order.orderNumber} token={t ?? null} canPay={order.canPay} failed={payment === "failed"} />}
        {order.status === "confirmed" && (
          <p className="text-sm text-muted-foreground">We&apos;ve emailed your receipt to {order.contactEmail}. Each seller will update you as your items are prepared.</p>
        )}
        {order.status === "cancelled" && (
          <Button asChild variant="outline">
            <Link href="/cart">Back to your cart</Link>
          </Button>
        )}
        {!user && order.status !== "cancelled" && (
          <Alert variant="info" className="max-w-2xl">
            Keep this page&apos;s link (it&apos;s also in your email) to check your order later, or{" "}
            <Link href="/auth/sign-up" className="underline">
              create an account
            </Link>{" "}
            for faster checkout next time.
          </Alert>
        )}
      </div>
      <OrderDetail order={order} token={t ?? null} conversations={conversations} />
    </main>
  );
}
