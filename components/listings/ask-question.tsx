"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askQuestionAction } from "@/lib/questions/actions";
import type { ActionResult } from "@/lib/validation/form-result";

export function AskQuestion({ kind, id, signedIn, returnTo }: { kind: "product" | "service"; id: string; signedIn: boolean; returnTo: string }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (!signedIn) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link href={`/auth/sign-in?next=${encodeURIComponent(returnTo)}`} className="font-medium text-primary underline">
          Sign in
        </Link>{" "}
        to ask the seller a question.
      </p>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await askQuestionAction({ kind, id, question });
          setResult(res);
          if (res.ok) setQuestion("");
        });
      }}
    >
      {result && <Alert variant={result.ok ? "success" : "danger"}>{result.ok ? result.message : (result.fieldErrors?.question?.[0] ?? result.error)}</Alert>}
      <label htmlFor={`ask-${id}`} className="text-sm font-medium">
        Ask the seller
      </label>
      <Textarea id={`ask-${id}`} rows={2} maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="For example: does it come with a warranty?" />
      <p className="text-xs text-muted-foreground">Your question and the seller&apos;s answer are shown here with your first name. Don&apos;t include phone numbers or addresses.</p>
      <Button type="submit" size="sm" variant="outline" className="self-start" disabled={pending || question.trim().length < 5}>
        {pending ? "Sending…" : "Ask"}
      </Button>
    </form>
  );
}
