"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { reviewSellerAction } from "@/lib/admin/seller-actions";
import type { ActionResult } from "@/lib/validation/form-result";

type Decision = "start_review" | "approve" | "reject" | "suspend" | "kyc_verified" | "kyc_failed";
const NEEDS_REASON: Decision[] = ["reject", "suspend", "kyc_failed"];

/** Decision buttons for one seller. Reasons are sent to the seller by email. */
export function SellerReviewPanel({ businessId, decisions }: { businessId: string; decisions: { decision: Decision; label: string; variant?: "default" | "outline" | "danger" }[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [asking, setAsking] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");

  const submit = (decision: Decision) =>
    start(async () => {
      const input = NEEDS_REASON.includes(decision) ? { businessId, decision, reason } : { businessId, decision };
      const res = await reviewSellerAction(input as Parameters<typeof reviewSellerAction>[0]);
      setResult(res);
      if (res.ok) {
        setAsking(null);
        setReason("");
      }
    });

  if (decisions.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {result && (result.ok ? <Alert variant="success">{result.message}</Alert> : <Alert variant="danger">{result.error}</Alert>)}
      {asking ? (
        <div className="flex flex-col gap-3">
          <FormField
            id="reason"
            label={asking === "kyc_failed" ? "What's wrong with the documents?" : asking === "suspend" ? "Why is this store suspended?" : "What must the seller fix?"}
            hint="The seller sees this in an email. Be specific and polite."
            error={!result?.ok && result?.fieldErrors?.reason?.[0] ? result.fieldErrors.reason[0] : undefined}
          >
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </FormField>
          <div className="flex gap-2">
            <Button variant="danger" disabled={pending || reason.trim().length < 10} onClick={() => submit(asking)}>
              {pending ? "Saving…" : "Confirm"}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {decisions.map((d) => (
            <Button
              key={d.decision}
              variant={d.variant ?? "outline"}
              disabled={pending}
              onClick={() => (NEEDS_REASON.includes(d.decision) ? setAsking(d.decision) : submit(d.decision))}
            >
              {d.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
