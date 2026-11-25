"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { settleFakePaymentAction } from "@/lib/checkout/actions";

export function FakePayButtons({ reference }: { reference: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const settle = (outcome: "success" | "failed") =>
    start(async () => {
      const res = await settleFakePaymentAction({ reference, outcome });
      if (res.ok && res.data) window.location.assign(res.data.redirectTo);
      else if (!res.ok) setError(res.error);
    });
  return (
    <div className="flex flex-col gap-3">
      <Button size="lg" onClick={() => settle("success")} disabled={pending}>
        Pay (test card succeeds)
      </Button>
      <Button size="lg" variant="outline" onClick={() => settle("failed")} disabled={pending}>
        Decline
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
