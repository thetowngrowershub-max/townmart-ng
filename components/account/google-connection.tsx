"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { connectGoogleAction, disconnectGoogleAction } from "@/lib/auth/actions";
import type { ActionResult } from "@/lib/validation/form-result";

export function GoogleConnection({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (!connected) {
    return (
      <form action={connectGoogleAction}>
        <Button type="submit" variant="outline">
          Connect Google
        </Button>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {result && <Alert variant={result.ok ? "success" : "danger"}>{result.ok ? result.message : result.error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">You can sign in with Google.</p>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setResult(await disconnectGoogleAction());
              router.refresh();
            })
          }
        >
          Disconnect
        </Button>
      </div>
    </div>
  );
}
