"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import type { ActionResult } from "@/lib/validation/form-result";

/** Runs a Server Action, keeps its result for an alert, and refreshes the page when it worked. */
export function useAction() {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, onDone?: () => void) =>
    start(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) {
        onDone?.();
        router.refresh();
      }
    });
  return { result, pending, run, fieldError: (k: string) => (result && !result.ok ? result.fieldErrors?.[k]?.[0] : undefined) };
}

export function ActionAlert({ result }: { result: ActionResult<unknown> | null }) {
  if (!result) return null;
  return <Alert variant={result.ok ? "success" : "danger"}>{result.ok ? result.message : result.error}</Alert>;
}
