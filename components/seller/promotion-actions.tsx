"use client";

import { Pause, Play, Square, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { changePromotionAction, deletePromotionAction } from "@/lib/promotions/actions";
import type { PromotionStatus } from "@/lib/promotions/promotions";
import type { ActionResult } from "@/lib/validation/form-result";

/** Pause, resume, end now, or delete (only if nobody has used it). */
export function PromotionActions({ id, status, used }: { id: string; status: PromotionStatus; used: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) (after ?? router.refresh)();
    });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {(status === "live" || status === "scheduled") && (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => changePromotionAction({ id, change: "pause" }))}>
            <Pause aria-hidden /> Pause
          </Button>
        )}
        {status === "paused" && (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => changePromotionAction({ id, change: "resume" }))}>
            <Play aria-hidden /> Resume
          </Button>
        )}
        {status !== "ended" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (window.confirm("End this promotion now? Shoppers stop getting the discount straight away.")) run(() => changePromotionAction({ id, change: "end" }));
            }}
          >
            <Square aria-hidden /> End now
          </Button>
        )}
        {!used && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Delete this promotion? This can't be undone.")) run(() => deletePromotionAction(id), () => router.push("/dashboard/promotions"));
            }}
          >
            <Trash2 aria-hidden /> Delete
          </Button>
        )}
      </div>
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
    </div>
  );
}
