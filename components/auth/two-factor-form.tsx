"use client";

import { useState, useTransition } from "react";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { resendTwoFactorAction, verifyTwoFactorAction } from "@/lib/auth/two-factor-actions";
import { otpCode } from "@/lib/validation/common";
import type { ActionResult } from "@/lib/validation/form-result";
import { z } from "zod";

const schema = z.object({ code: otpCode });

/** The second step of signing in: the code sent by SMS. */
export function TwoFactorForm() {
  const { form, onSubmit, pending, result } = useActionForm(schema, verifyTwoFactorAction, { code: "" });
  const [resent, setResent] = useState<ActionResult | null>(null);
  const [resending, start] = useTransition();
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {result && !result.ok && !result.fieldErrors && <Alert variant="danger">{result.error}</Alert>}
      {resent && <Alert variant={resent.ok ? "success" : "danger"}>{resent.ok ? resent.message : resent.error}</Alert>}
      <FormField id="code" label="6-digit code" error={form.formState.errors.code?.message}>
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus {...form.register("code")} />
      </FormField>
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </Button>
      <Button type="button" variant="ghost" disabled={resending} onClick={() => start(async () => setResent(await resendTwoFactorAction()))}>
        Send a new code
      </Button>
    </form>
  );
}
