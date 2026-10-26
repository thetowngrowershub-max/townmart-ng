"use client";

import { PackageCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { confirmReceivedAction } from "@/lib/fulfilment/customer-actions";

/** "It arrived": completes the seller's part of a delivered order. */
export function ConfirmReceived({ orderNumber, token, sellerOrderId }: { orderNumber: string; token: string | null; sellerOrderId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await confirmReceivedAction({ orderNumber, token, sellerOrderId });
            if (res.ok) router.refresh();
            else setError(res.error);
          })
        }
      >
        <PackageCheck aria-hidden /> I received it
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
