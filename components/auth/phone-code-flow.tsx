"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/validation/form-result";

/**
 * Two steps: enter a phone number and get a code, then enter the code.
 * Shared by phone sign-in and adding a phone to your account.
 */
export function PhoneCodeFlow({
  send,
  verify,
  submitLabel,
  initialPhone = "",
  onVerified,
}: {
  send: (input: { phone: string }) => Promise<ActionResult>;
  verify: (input: { phone: string; code: string }) => Promise<ActionResult>;
  submitLabel: string;
  initialPhone?: string;
  onVerified?: () => void;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<ActionResult | null>(null);
  const [verified, setVerified] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const codeSent = sent?.ok === true;
  const fieldError = (r: ActionResult | null, f: string) => (r && !r.ok ? r.fieldErrors?.[f]?.[0] : undefined);

  return (
    <div className="flex flex-col gap-4">
      {sent && (sent.ok ? <Alert variant="success">{sent.message}</Alert> : !sent.fieldErrors && <Alert variant="danger">{sent.error}</Alert>)}
      {verified && (verified.ok ? <Alert variant="success">{verified.message}</Alert> : !verified.fieldErrors && <Alert variant="danger">{verified.error}</Alert>)}
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setVerified(null);
            setSent(await send({ phone }));
          });
        }}
      >
        <FormField id="phone" label="Phone number" hint="Nigerian mobile, e.g. 0803 123 4567" error={fieldError(sent, "phone")}>
          <Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </FormField>
        <Button type="submit" variant={codeSent ? "outline" : "default"} disabled={pending || !phone}>
          {codeSent ? "Send a new code" : "Send code"}
        </Button>
      </form>
      {codeSent && (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await verify({ phone, code });
              setVerified(res);
              if (res.ok) onVerified?.();
            });
          }}
        >
          <FormField id="code" label="6-digit code" error={fieldError(verified, "code")}>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value)} />
          </FormField>
          <Button type="submit" disabled={pending || code.length !== 6}>
            {pending ? "Checking…" : submitLabel}
          </Button>
        </form>
      )}
    </div>
  );
}
