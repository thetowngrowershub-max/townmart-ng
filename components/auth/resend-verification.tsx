"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resendVerificationAction } from "@/lib/auth/actions";
import type { ActionResult } from "@/lib/validation/form-result";

export function ResendVerification({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <Alert variant="warning" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <span>
        {result ? (result.ok ? result.message : result.error) : `Please confirm your email address (${email}) using the link we sent you.`}
      </span>
      {!result?.ok && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => setResult(await resendVerificationAction()))}>
          {pending ? "Sending…" : "Resend link"}
        </Button>
      )}
    </Alert>
  );
}
