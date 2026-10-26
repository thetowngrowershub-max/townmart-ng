"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { checkPaymentAction, retryPaymentAction } from "@/lib/checkout/actions";

/**
 * Shown while an order awaits payment. On arrival (usually straight back from
 * the payment page) it asks the server to check with the provider, then
 * refreshes; the shopper can also check again or retry the payment.
 */
export function PaymentStatus({ orderNumber, token, canPay, failed }: { orderNumber: string; token: string | null; canPay: boolean; failed: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [retrying, startRetry] = useTransition();
  const checked = useRef(false);

  const check = () =>
    startCheck(async () => {
      const res = await checkPaymentAction({ orderNumber, token });
      if (!res.ok) return setMessage(res.error);
      const status = res.data?.status;
      if (status === "paid" || status === "already_paid" || status === "success") return router.refresh();
      if (status === "needs_attention") return setMessage("We received a payment we need to check by hand. Our team will contact you; you don't need to pay again.");
      setMessage(status === "not_paid" || status === "failed" || status === "abandoned" ? "We haven't received your payment yet." : null);
    });

  useEffect(() => {
    if (checked.current || failed) return;
    checked.current = true;
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on arrival
  }, []);

  const retry = () =>
    startRetry(async () => {
      const res = await retryPaymentAction({ orderNumber, token });
      if (res.ok && res.data) window.location.assign(res.data.redirectTo);
      else if (!res.ok) setMessage(res.error);
    });

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {failed && <Alert variant="danger">We couldn&apos;t open the payment page. Your items are still held; please try again.</Alert>}
      {checking && <p className="text-sm text-muted-foreground">Checking your payment…</p>}
      {message && <Alert variant="warning">{message}</Alert>}
      <div className="flex flex-wrap gap-2">
        {canPay && (
          <Button onClick={retry} disabled={retrying || checking}>
            {retrying ? "Opening the payment page…" : "Pay now"}
          </Button>
        )}
        <Button variant="outline" onClick={check} disabled={checking || retrying}>
          I&apos;ve paid: check again
        </Button>
      </div>
    </div>
  );
}
