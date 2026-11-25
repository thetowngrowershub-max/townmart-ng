"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { replyToReviewAction } from "@/lib/reviews/actions";

/** The seller's public reply to a review; opens with the current reply when editing. */
export function ReplyForm({ reviewId, current }: { reviewId: string; current: string | null }) {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <Button size="sm" variant={current ? "ghost" : "outline"} className="self-start" onClick={() => setOpen(true)}>
        {current ? "Edit reply" : "Reply"}
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await replyToReviewAction({ reviewId, reply });
          if (res.ok) setOpen(false);
          else setError(res.fieldErrors?.reply?.[0] ?? res.error);
        });
      }}
    >
      <label htmlFor={`reply-${reviewId}`} className="text-sm font-medium">
        Your public reply
      </label>
      <Textarea id={`reply-${reviewId}`} rows={3} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Thank the customer, or explain what you'll do about it." />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Posting…" : "Post reply"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Everyone who reads the review sees your reply.</p>
    </form>
  );
}
