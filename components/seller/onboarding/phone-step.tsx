"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { sendBusinessPhoneCodeAction, verifyBusinessPhoneAction } from "@/lib/seller/actions";
import type { ActionResult } from "@/lib/validation/form-result";
import { verifyPhoneSchema } from "@/lib/validation/seller";

export function PhoneStep({ phoneMasked }: { phoneMasked: string }) {
  const router = useRouter();
  const [sent, setSent] = useState<ActionResult | null>(null);
  const [sending, startSending] = useTransition();
  const { form, onSubmit, pending, result } = useActionForm(
    verifyPhoneSchema,
    async (values) => {
      const res = await verifyBusinessPhoneAction(values);
      if (res.ok) router.push("/sell/onboarding");
      return res;
    },
    { code: "" },
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm">
        We&apos;ll text a 6-digit code to <strong>{phoneMasked}</strong>. Wrong number? Go back to Business details.
      </p>
      {sent && (sent.ok ? <Alert variant="success">{sent.message}</Alert> : <Alert variant="danger">{sent.error}</Alert>)}
      <Button
        type="button"
        variant={sent?.ok ? "outline" : "default"}
        className="self-start"
        disabled={sending}
        onClick={() => startSending(async () => setSent(await sendBusinessPhoneCodeAction()))}
      >
        {sending ? "Sending…" : sent?.ok ? "Send a new code" : "Send code"}
      </Button>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {result && !result.ok && !result.fieldErrors && <Alert variant="danger">{result.error}</Alert>}
        <FormField id="code" label="Code" error={form.formState.errors.code?.message}>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="max-w-40 tracking-[0.4em]" {...form.register("code")} />
        </FormField>
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Checking…" : "Verify phone"}
        </Button>
      </form>
    </div>
  );
}
