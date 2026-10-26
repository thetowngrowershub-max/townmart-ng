import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FakePayButtons } from "@/components/checkout/fake-pay-buttons";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { formatPrice } from "@/lib/money";
import { FakePaymentProvider } from "@/lib/payments/fake";

export const metadata: Metadata = { title: "Test payment", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Development stand-in for Paystack's hosted page (PAYMENT_PROVIDER=fake only). */
export default async function FakePay({ searchParams }: { searchParams: Promise<{ reference?: string }> }) {
  if (env().NODE_ENV === "production" || env().PAYMENT_PROVIDER !== "fake") notFound();
  const { reference } = await searchParams;
  const details = reference ? await FakePaymentProvider.details(reference) : null;
  return (
    <main id="main" className="mx-auto flex max-w-md flex-col gap-4 px-4 py-12">
      <Alert variant="warning">Test mode: no money moves. This page stands in for the payment provider in local development.</Alert>
      <Card>
        <CardHeader>
          <CardTitle>{details ? `Pay ${formatPrice(details.amountKobo)}` : "Payment not found"}</CardTitle>
          <CardDescription>Reference {reference ?? "—"}</CardDescription>
        </CardHeader>
        <CardContent>{details && reference ? <FakePayButtons reference={reference} /> : <p className="text-sm text-muted-foreground">This test payment has expired.</p>}</CardContent>
      </Card>
    </main>
  );
}
