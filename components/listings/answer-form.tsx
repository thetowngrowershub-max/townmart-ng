"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { answerQuestionAction } from "@/lib/questions/actions";

/** The shop's public answer to a shopper's question; opens with the current answer when editing. */
export function AnswerForm({ questionId, current }: { questionId: string; current: string | null }) {
  const [open, setOpen] = useState(!current);
  const [answer, setAnswer] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <Button size="sm" variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        Edit answer
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await answerQuestionAction({ id: questionId, answer });
          if (res.ok) setOpen(false);
          else setError(res.fieldErrors?.answer?.[0] ?? res.error);
        });
      }}
    >
      <label htmlFor={`answer-${questionId}`} className="text-sm font-medium">
        Your answer
      </label>
      <Textarea id={`answer-${questionId}`} rows={3} maxLength={2000} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer clearly. Shoppers and TownMart can read it." />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Posting…" : current ? "Save answer" : "Post answer"}
        </Button>
        {current && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Answering makes the question and your answer public on the listing.</p>
    </form>
  );
}
