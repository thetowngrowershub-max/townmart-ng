"use client";

import { useAction } from "@/components/admin/use-action";
import { Button } from "@/components/ui/button";
import { retryAllFailedAction, retryJobAction } from "@/lib/admin/system-actions";

export function RetryJobButton({ queue, jobId }: { queue: string; jobId: string }) {
  const { result, pending, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={pending || result?.ok} onClick={() => run(() => retryJobAction({ queue, jobId }))}>
        {result?.ok ? "Queued" : "Retry"}
      </Button>
      {result && !result.ok && <span className="text-xs text-danger">{result.error}</span>}
    </span>
  );
}

export function RetryAllButton({ queue, count }: { queue: string; count: number }) {
  const { result, pending, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(`Retry all ${count} failed jobs in ${queue}?`) && run(() => retryAllFailedAction({ queue }))}>
        Retry all {count}
      </Button>
      {result && <span className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-danger"}>{result.ok ? result.message : result.error}</span>}
    </span>
  );
}
