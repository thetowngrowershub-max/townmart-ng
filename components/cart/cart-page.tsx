import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CheckoutView } from "@/lib/checkout/view";
import { CartLine } from "./cart-line";
import { CouponForm } from "./coupon-form";
import { OrderSummary } from "./order-summary";

export function CartPage({ view, signedIn }: { view: CheckoutView; signedIn: boolean }) {
  if (view.itemCount === 0 && view.saved.length === 0) {
    return (
      <Card className="p-10 text-center">
        <p className="text-lg font-semibold">Your cart is empty.</p>
        <p className="mt-1 text-muted-foreground">Find something you like and add it here.</p>
        <Button asChild className="mt-6">
          <Link href="/deals">See today&apos;s deals</Link>
        </Button>
      </Card>
    );
  }
  const problems = view.sellers.some((s) => s.lines.some((l) => l.problem));
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-6">
        {problems && <Alert variant="warning">Some items changed since you added them. Please check the highlighted items.</Alert>}
        {view.sellers.map((s) => (
          <Card key={s.businessId}>
            <CardHeader className="flex-row items-baseline justify-between gap-4">
              <div>
                <CardTitle>
                  <Link href={s.href} className="hover:underline">
                    {s.name}
                  </Link>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{s.location}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {!s.hasGoods ? "Booking" : s.offersDelivery && s.offersPickup ? "Delivery or pickup" : s.offersPickup ? "Pickup only" : "Delivery"}
              </p>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {s.lines.map((l) => (
                  <CartLine key={l.id} line={l} />
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
        {view.saved.length > 0 && (
          <section aria-labelledby="saved">
            <h2 id="saved" className="mb-2 text-xl font-bold">
              Saved for later
            </h2>
            <Card>
              <CardContent>
                <ul className="divide-y">
                  {view.saved.map((l) => (
                    <CartLine key={l.id} line={l} saved />
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        )}
      </div>
      {view.itemCount > 0 && (
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Order summary</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <CouponForm coupon={view.coupon} />
              <OrderSummary totals={view.totals} totalLabel="Total before delivery" />
              {view.blockers.length ? (
                <Button size="lg" className="w-full" disabled>
                  Check out
                </Button>
              ) : (
                <Button asChild size="lg" className="w-full">
                  <Link href="/checkout">Check out</Link>
                </Button>
              )}
              {!signedIn && (
                <p className="text-center text-sm text-muted-foreground">
                  <Link href="/auth/sign-in?next=/checkout" className="text-primary underline">
                    Sign in
                  </Link>{" "}
                  to use saved addresses, or check out as a guest.
                </p>
              )}
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden /> Sellers are paid only after your order is delivered.
              </p>
            </CardContent>
          </Card>
        </aside>
      )}
    </div>
  );
}
