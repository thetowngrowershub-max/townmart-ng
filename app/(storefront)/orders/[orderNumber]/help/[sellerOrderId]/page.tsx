import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelPaidOrder, CustomerDispute, OpenDisputeForm, RefundRequestForm } from "@/components/refunds/customer-help";
import { RefundList } from "@/components/refunds/refund-list";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withSystemContext } from "@/lib/db";
import { findViewableOrder } from "@/lib/orders/access";
import { CUSTOMER_REASONS, PHOTO_REQUIRED, REASON_LABELS } from "@/lib/refunds/math";
import { loadHelp } from "@/lib/refunds/view";

export const metadata: Metadata = { title: "Help with your order", robots: { index: false } };

export default async function OrderHelp({ params, searchParams }: { params: Promise<{ orderNumber: string; sellerOrderId: string }>; searchParams: Promise<{ t?: string }> }) {
  const { orderNumber, sellerOrderId } = await params;
  const { t } = await searchParams;
  const found = await findViewableOrder(orderNumber, t);
  if (!found) notFound();
  // Access was checked above; read in the system scope so guests with the link can use it too.
  const help = await withSystemContext((tx) => loadHelp(tx, found.id, sellerOrderId));
  if (!help) notFound();
  const user = await getCurrentUser();
  const token = t ?? null;
  const order = { orderNumber, token, sellerOrderId };
  const back = user && found.userId === user.id ? `/account/orders/${orderNumber}` : `/checkout/complete/${orderNumber}${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  const reasons = CUSTOMER_REASONS.filter((r) => (help.isBooking ? r !== "not_received" && r !== "changed_mind" : r !== "provider_no_show")).map((r) => ({ value: r, label: REASON_LABELS[r], photo: PHOTO_REQUIRED.has(r) }));

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <Link href={back} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Back to order {orderNumber}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Help with your order from {help.shopName}</h1>
        <p className="mt-1 text-muted-foreground">
          {help.status} · you paid {help.paid}
          {help.left !== help.paid && !help.payOnDelivery && ` · ${help.left} can still be refunded`}
        </p>
      </div>

      {help.dispute && (
        <Card>
          <CardHeader>
            <CardTitle>{help.dispute.status === "open" ? "TownMart is looking into it" : "TownMart's decision"}</CardTitle>
            <CardDescription>
              Opened {help.dispute.openedAt}
              {help.dispute.refundNumber && ` about refund ${help.dispute.refundNumber}`}. Everything here is seen by you, the seller and TownMart.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CustomerDispute order={order} dispute={help.dispute} />
          </CardContent>
        </Card>
      )}

      {help.refunds.length > 0 && (
        <section aria-labelledby="refunds-h" className="flex flex-col gap-3">
          <h2 id="refunds-h" className="text-lg font-semibold">
            Refunds
          </h2>
          <RefundList refunds={help.refunds} side="customer" evidenceQuery={token ? `?t=${encodeURIComponent(token)}` : ""} />
        </section>
      )}

      {help.canCancel && (
        <Card>
          <CardHeader>
            <CardTitle>Changed your mind?</CardTitle>
            <CardDescription>The seller hasn&apos;t started on this yet, so you can cancel it for a full refund.</CardDescription>
          </CardHeader>
          <CardContent>
            <CancelPaidOrder order={order} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Ask for a refund or return</CardTitle>
          <CardDescription>
            {help.request.allowed
              ? `Tell ${help.shopName} what went wrong. ${help.request.closesAt ? `You can ask until ${help.request.closesAt}; fresh produce within 24 hours of delivery. ` : ""}Refunds go back to your original payment method.`
              : help.request.why}
          </CardDescription>
        </CardHeader>
        {help.request.allowed && (
          <CardContent>
            <RefundRequestForm order={order} items={help.items} reasons={reasons} />
          </CardContent>
        )}
      </Card>

      {!help.dispute || help.dispute.status !== "open" ? (
        help.canDispute.allowed && (
          <Card>
            <CardHeader>
              <CardTitle>Can&apos;t sort it out with the seller?</CardTitle>
              <CardDescription>
                {help.canDispute.refundId ? "The seller declined your refund. If you think that's wrong, TownMart can decide." : "Message the seller from your order page first. If that doesn't help, TownMart can step in and decide."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OpenDisputeForm order={order} refundId={help.canDispute.refundId} />
            </CardContent>
          </Card>
        )
      ) : null}

      <Alert variant="info">
        See our{" "}
        <Link href="/legal/refunds">Refund Policy</Link> for what can be returned and when.
      </Alert>
    </main>
  );
}
