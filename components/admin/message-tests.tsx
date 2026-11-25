"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { sendTestEmailAction, sendTestSmsAction } from "@/lib/admin/message-test-actions";
import type { ActionResult } from "@/lib/validation/form-result";

function useSend() {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setResult(await fn());
      // Refresh either way: a failure shows up in the list below.
      router.refresh();
    });
  return { result, pending, run };
}

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return <Alert variant={result.ok ? "success" : "danger"}>{result.ok ? result.message : result.error}</Alert>;
}

export function TestSmsForm() {
  const [phone, setPhone] = useState("");
  const { result, pending, run } = useSend();
  const fieldError = result && !result.ok ? result.fieldErrors?.phone?.[0] : undefined;
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => sendTestSmsAction({ phone }));
      }}
    >
      <Result result={fieldError ? null : result} />
      <FormField id="test-sms-phone" label="Send a test text to" hint="Your own Nigerian mobile number" error={fieldError}>
        <Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </FormField>
      <Button type="submit" variant="outline" size="sm" className="self-start" disabled={pending || !phone}>
        {pending ? "Sending…" : "Send test text"}
      </Button>
    </form>
  );
}

export function TestEmailButton({ email }: { email: string }) {
  const { result, pending, run } = useSend();
  return (
    <div className="flex flex-col gap-3">
      <Result result={result} />
      <Button variant="outline" size="sm" className="self-start" disabled={pending} onClick={() => run(sendTestEmailAction)}>
        {pending ? "Sending…" : `Send a test email to ${email}`}
      </Button>
    </div>
  );
}
