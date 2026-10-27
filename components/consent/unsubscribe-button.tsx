"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { unsubscribeAction } from "@/lib/marketing-actions";

export function UnsubscribeButton({ e, t }: { e: string; t: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (done) return <Alert variant="success">You&apos;re unsubscribed. We won&apos;t send you offers again. Order and account emails still come as normal.</Alert>;
  return (
    <div className="flex flex-col gap-3">
      {error && <Alert variant="danger">{error}</Alert>}
      <Button
        className="self-start"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await unsubscribeAction({ e, t });
            if (res.ok) setDone(true);
            else setError(res.error);
          })
        }
      >
        {pending ? "Unsubscribing…" : "Unsubscribe"}
      </Button>
    </div>
  );
}
