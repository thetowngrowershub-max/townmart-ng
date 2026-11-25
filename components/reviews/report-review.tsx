"use client";

import { Flag } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reportReviewAction } from "@/lib/reviews/actions";

/** "Report" link under a review: a reason, then it goes to moderation. */
export function ReportReview({ reviewId }: { reviewId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (msg) return <p className="text-xs text-muted-foreground">{msg}</p>;
  if (!open)
    return (
      <button type="button" className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:underline" onClick={() => setOpen(true)}>
        <Flag className="size-3" aria-hidden /> Report
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await reportReviewAction({ reviewId, reason });
          setMsg(res.ok ? (res.message ?? "Reported.") : (res.fieldErrors?.reason?.[0] ?? res.error));
        });
      }}
    >
      <label htmlFor={`report-${reviewId}`} className="sr-only">
        Why are you reporting this review?
      </label>
      <Input id={`report-${reviewId}`} className="h-9 max-w-xs text-sm" placeholder="What's wrong with it?" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Report
      </Button>
    </form>
  );
}
