"use client";

import { Tag, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyCouponAction, removeCouponAction } from "@/lib/cart/actions";
import type { CheckoutView } from "@/lib/checkout/view";

export function CouponForm({ coupon }: { coupon: CheckoutView["coupon"] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (coupon.code) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 font-mono font-semibold">
            <Tag className="size-4" aria-hidden /> {coupon.code.toUpperCase()}
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-muted-foreground underline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await removeCouponAction();
                router.refresh();
              })
            }
          >
            <X className="size-3" aria-hidden /> Remove
          </button>
        </div>
        {coupon.state === "applied" && <p className="text-success">Code applied: you save {coupon.saving}.</p>}
        {coupon.message && <p className="text-danger">{coupon.message}</p>}
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await applyCouponAction({ code });
          setError(res.ok ? null : (res.fieldErrors?.code?.[0] ?? res.error));
          if (res.ok) {
            setCode("");
            router.refresh();
          }
        });
      }}
    >
      <label htmlFor="coupon" className="text-sm font-medium">
        Coupon code
      </label>
      <div className="flex gap-2">
        <Input id="coupon" className="uppercase" autoComplete="off" maxLength={24} value={code} onChange={(e) => setCode(e.target.value)} aria-describedby={error ? "coupon-error" : undefined} />
        <Button type="submit" variant="outline" disabled={pending || code.trim().length < 4}>
          Apply
        </Button>
      </div>
      {error && (
        <p id="coupon-error" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
