"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { verifyEmailAction } from "@/lib/auth/actions";
import type { ActionResult } from "@/lib/validation/form-result";

/** Verification happens on an explicit click, so link scanners that prefetch email links can't consume the token. */
export function VerifyEmailButton({ email, token }: { email: string; token: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  if (result?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="success">{result.message}</Alert>
        <Button asChild>
          <Link href="/account">Go to my account</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      <p className="text-sm text-muted-foreground">
        Confirm that <strong className="text-foreground">{email}</strong> is your email address.
      </p>
      <Button disabled={pending} onClick={() => startTransition(async () => setResult(await verifyEmailAction({ email, token })))}>
        {pending ? "Confirming…" : "Confirm my email"}
      </Button>
    </div>
  );
}
