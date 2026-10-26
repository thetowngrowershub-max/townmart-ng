"use client";

import { Lock, MapPin, Truck, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { CartLine } from "@/components/cart/cart-line";
import { AddressFields, EMPTY_ADDRESS, type StateOption } from "@/components/checkout/address-fields";
import { OrderSummary } from "@/components/cart/order-summary";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { placeOrderAction, quoteCheckoutAction } from "@/lib/checkout/actions";
import type { CheckoutView } from "@/lib/checkout/view";
import { cn } from "@/lib/utils";

export type SavedAddress = { id: string; label: string | null; recipientName: string; summary: string; stateId: number; lgaId: number };

export function CheckoutForm({
  initialView,
  savedAddresses,
  states,
  account,
}: {
  initialView: CheckoutView;
  savedAddresses: SavedAddress[];
  states: StateOption[];
  account: { email: string; name: string | null } | null;
}) {
  const [view, setView] = useState(initialView);
  const [email, setEmail] = useState("");
  const [addressId, setAddressId] = useState<string>(savedAddresses[0]?.id ?? "new");
  const [address, setAddress] = useState<typeof EMPTY_ADDRESS>({ ...EMPTY_ADDRESS, recipientName: account?.name ?? "" });
  const [saveAddress, setSaveAddress] = useState(true);
  const [methods, setMethods] = useState<Record<string, "delivery" | "pickup">>({});
  const [payment, setPayment] = useState<"online" | "pay_on_delivery">("online");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [quoting, startQuote] = useTransition();
  const [placing, startPlace] = useTransition();
  const quoteSeq = useRef(0);

  const usingNew = addressId === "new";
  const hasDestination = usingNew ? Boolean(address.stateId && address.lgaId) : true;

  // Re-price whenever the destination or a delivery choice changes.
  useEffect(() => {
    const seq = ++quoteSeq.current;
    startQuote(async () => {
      const res = await quoteCheckoutAction(
        usingNew ? { stateId: Number(address.stateId) || undefined, lgaId: Number(address.lgaId) || undefined, methods } : { addressId, methods },
      );
      if (seq === quoteSeq.current && res.ok && res.data) setView(res.data);
    });
  }, [addressId, usingNew, address.stateId, address.lgaId, methods]);

  useEffect(() => {
    if (payment === "pay_on_delivery" && !view.payOnDeliveryAvailable) setPayment("online");
  }, [payment, view.payOnDeliveryAvailable]);

  const err = (k: string) => errors[k];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setErrors({});
    startPlace(async () => {
      const res = await placeOrderAction({
        email: account ? "" : email,
        addressId: usingNew ? "" : addressId,
        address: usingNew ? { ...address, stateId: Number(address.stateId), lgaId: Number(address.lgaId) } : undefined,
        saveAddress: Boolean(account) && usingNew && saveAddress,
        methods,
        payment,
        acceptTerms: acceptTerms as true,
        marketingConsent: marketing,
        expectedTotalKobo: view.totals.totalKobo,
      });
      if (res.ok && res.data) {
        window.location.assign(res.data.redirectTo);
        return;
      }
      if (!res.ok) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) fe[k] = v[0] ?? "";
        setErrors(fe);
        setFormError(res.error);
        // Prices may have moved: show the new figures.
        const q = await quoteCheckoutAction(usingNew ? { stateId: Number(address.stateId) || undefined, lgaId: Number(address.lgaId) || undefined, methods } : { addressId, methods });
        if (q.ok && q.data) setView(q.data);
      }
    });
  };

  const blockers = hasDestination ? view.blockers : view.blockers.filter((b) => !b.includes("deliver"));
  const canPay = hasDestination && blockers.length === 0 && view.sellers.every((s) => s.method !== null);

  return (
    <form onSubmit={submit} noValidate className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-6">
        {!account && (
          <Card>
            <CardHeader>
              <CardTitle>Your email</CardTitle>
              <CardDescription>
                For your receipt and order updates. Have an account?{" "}
                <Link href="/auth/sign-in?next=/checkout" className="text-primary underline">
                  Sign in
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField id="email" label="Email" error={err("email")}>
                <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </FormField>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Delivery address</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {savedAddresses.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Choose an address</legend>
                {[...savedAddresses.map((a) => ({ id: a.id, title: a.label ?? a.recipientName, body: a.summary })), { id: "new", title: "Use a new address", body: "" }].map((o) => (
                  <label key={o.id} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", addressId === o.id && "border-primary bg-primary-soft")}>
                    <input type="radio" name="addressId" className="mt-1 size-4 accent-primary" checked={addressId === o.id} onChange={() => setAddressId(o.id)} />
                    <span className="text-sm">
                      <span className="font-medium">{o.title}</span>
                      {o.body && <span className="block text-muted-foreground">{o.body}</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {err("addressId") && <p className="text-sm text-danger">{err("addressId")}</p>}
            {usingNew && (
              <div className="flex flex-col gap-4">
                <AddressFields value={address} onChange={setAddress} states={states} errors={errors} errorPrefix="address." />
                {account && (
                  <div className="sm:col-span-2">
                    <Checkbox id="saveAddress" label="Save this address to my account" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {view.sellers.map((s) => (
          <Card key={s.businessId}>
            <CardHeader>
              <CardTitle>{s.name}</CardTitle>
              <CardDescription>
                {s.location} · {s.returnWindowDays > 0 ? `Returns accepted within ${s.returnWindowDays} days` : "Returns only for faulty or wrong items"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ul className="divide-y">
                {s.lines.map((l) => (
                  <CartLine key={l.id} line={l} readOnly />
                ))}
              </ul>
              <fieldset className="flex flex-col gap-2" disabled={!hasDestination}>
                <legend className="mb-1 text-sm font-medium">How would you like to get it?</legend>
                {s.offersDelivery && (
                  <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", s.method === "delivery" && "border-primary bg-primary-soft", !s.delivery && "cursor-not-allowed opacity-60")}>
                    <input type="radio" name={`m-${s.businessId}`} className="mt-1 size-4 accent-primary" disabled={!s.delivery} checked={s.method === "delivery"} onChange={() => setMethods((m) => ({ ...m, [s.businessId]: "delivery" }))} />
                    <Truck className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="flex-1 text-sm">
                      <span className="font-medium">Delivery</span>
                      {s.delivery ? (
                        <span className="block text-muted-foreground">
                          {s.delivery.eta} to {s.delivery.zone}
                          {s.delivery.freeOver && ` · free over ${s.delivery.freeOver}`}
                        </span>
                      ) : (
                        <span className="block text-muted-foreground">{hasDestination ? "Not available to this address" : "Enter your address to see the fee"}</span>
                      )}
                    </span>
                    {s.delivery && <span className="text-sm font-semibold tabular-nums">{s.delivery.fee}</span>}
                  </label>
                )}
                {s.offersPickup && (
                  <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", s.method === "pickup" && "border-primary bg-primary-soft")}>
                    <input type="radio" name={`m-${s.businessId}`} className="mt-1 size-4 accent-primary" checked={s.method === "pickup"} onChange={() => setMethods((m) => ({ ...m, [s.businessId]: "pickup" }))} />
                    <Store className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="flex-1 text-sm">
                      <span className="font-medium">Pick up from the seller</span>
                      <span className="block text-muted-foreground">In {s.location}. The seller sends the address once your order is ready.</span>
                    </span>
                    <span className="text-sm font-semibold">Free</span>
                  </label>
                )}
                {s.deliveryNotes && <p className="text-xs text-muted-foreground">Seller&apos;s note: {s.deliveryNotes}</p>}
              </fieldset>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", payment === "online" && "border-primary bg-primary-soft")}>
              <input type="radio" name="payment" className="mt-1 size-4 accent-primary" checked={payment === "online"} onChange={() => setPayment("online")} />
              <span className="text-sm">
                <span className="font-medium">Pay now</span>
                <span className="block text-muted-foreground">Card, bank transfer or USSD on our payment partner&apos;s secure page. TownMart never sees your card details.</span>
              </span>
            </label>
            {view.payOnDeliveryAvailable && (
              <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", payment === "pay_on_delivery" && "border-primary bg-primary-soft")}>
                <input type="radio" name="payment" className="mt-1 size-4 accent-primary" checked={payment === "pay_on_delivery"} onChange={() => setPayment("pay_on_delivery")} />
                <span className="text-sm">
                  <span className="font-medium">Pay on delivery</span>
                  <span className="block text-muted-foreground">Pay the seller in cash or by transfer when your order arrives.</span>
                </span>
              </label>
            )}
          </CardContent>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Order summary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5" aria-busy={quoting}>
            {view.coupon.state === "applied" && (
              <p className="text-sm text-success">
                Code {view.coupon.code?.toUpperCase()} applied: you save {view.coupon.saving}.
              </p>
            )}
            {view.coupon.message && <p className="text-sm text-danger">{view.coupon.message}</p>}
            <OrderSummary totals={view.totals} totalLabel={payment === "pay_on_delivery" ? "To pay on delivery" : "Total to pay"} />
            <div className="flex flex-col gap-3">
              <Checkbox
                id="acceptTerms"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                label={
                  <>
                    I accept the{" "}
                    <Link href="/legal/terms" target="_blank" className="text-primary underline">
                      Terms of Use
                    </Link>{" "}
                    and{" "}
                    <Link href="/legal/refunds" target="_blank" className="text-primary underline">
                      Refund Policy
                    </Link>
                  </>
                }
              />
              {err("acceptTerms") && <p className="text-sm text-danger">{err("acceptTerms")}</p>}
              <Checkbox id="marketing" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} label="Send me TownMart offers by email and SMS (optional)" hint="You can stop these at any time." />
            </div>
            {formError && <Alert variant="danger">{formError}</Alert>}
            {hasDestination && blockers.map((b) => <Alert key={b} variant="warning">{b}</Alert>)}
            <Button type="submit" size="lg" className="w-full" disabled={placing || quoting || !canPay || !acceptTerms}>
              <Lock aria-hidden /> {placing ? "Placing your order…" : payment === "pay_on_delivery" ? "Place order" : `Pay ${view.totals.total}`}
            </Button>
            {!hasDestination && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="size-4" aria-hidden /> Add your address to see delivery fees.
              </p>
            )}
            {payment === "online" && <p className="text-xs text-muted-foreground">Your items are held for {view.holdMinutes} minutes while you pay.</p>}
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}
