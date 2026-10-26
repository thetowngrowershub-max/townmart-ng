"use client";

import { Banknote, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requestPayoutAction } from "@/lib/refunds/seller-actions";

export function RequestPayout({ disabled, amount }: { disabled: boolean; amount: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={disabled || pending}
        onClick={() =>
          start(async () => {
            const res = await requestPayoutAction();
            setMsg({ ok: res.ok, text: res.ok ? res.message! : res.error! });
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Banknote aria-hidden />} Pay out {amount} now
      </Button>
      <div aria-live="polite">{msg && <Alert variant={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}</div>
    </div>
  );
}
