"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { sendTwoFactorCodeAction, verifyTwoFactorAction } from "@/lib/auth/two-factor-actions";
import type { ActionResult } from "@/lib/validation/form-result";

export type FactorOption = { factor: "authenticator" | "sms" | "email" | "backup"; label: string; hint: string };

const PROMPT: Record<FactorOption["factor"], string> = {
  authenticator: "Open your authenticator app and enter the 6-digit TownMart code.",
  sms: "Enter the 6-digit code we texted to",
  email: "Enter the 6-digit code we emailed to",
  backup: "Enter one of the backup codes you saved when you turned on two-step sign-in. Each works once.",
};

/**
 * The second step of signing in. Starts on the account's preferred way and
 * lets the person switch to another (another app, a text, an email, a backup code).
 */
export function TwoFactorForm({ options, autoSent }: { options: FactorOption[]; autoSent: boolean }) {
  const [index, setIndex] = useState(0);
  const [sent, setSent] = useState<Record<string, boolean>>(() => (autoSent && options[0] ? { [options[0].factor]: true } : {}));
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [notice, setNotice] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const current = options[index]!;
  const needsSend = current.factor === "sms" || current.factor === "email";
  const ready = !needsSend || sent[current.factor];

  const send = () =>
    start(async () => {
      const res = await sendTwoFactorCodeAction({ factor: current.factor as "sms" | "email" });
      setNotice(res);
      if (res.ok) setSent((s) => ({ ...s, [current.factor]: true }));
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {PROMPT[current.factor]}
        {needsSend && <strong className="text-foreground"> {current.hint}</strong>}
        {needsSend && "."}
      </p>
      {notice && <Alert variant={notice.ok ? "success" : "danger"}>{notice.ok ? notice.message : notice.error}</Alert>}
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      {ready ? (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setResult(null);
            start(async () => setResult(await verifyTwoFactorAction({ factor: current.factor, code })));
          }}
        >
          <FormField id="code" label={current.factor === "backup" ? "Backup code" : "6-digit code"}>
            <Input
              inputMode={current.factor === "backup" ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize="none"
              maxLength={current.factor === "backup" ? 12 : 6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </FormField>
          <Button type="submit" disabled={pending}>
            {pending ? "Checking…" : "Sign in"}
          </Button>
          {needsSend && (
            <Button type="button" variant="ghost" disabled={pending} onClick={send}>
              Send a new code
            </Button>
          )}
        </form>
      ) : (
        <Button type="button" disabled={pending} onClick={send}>
          {current.factor === "sms" ? "Text me a code" : "Email me a code"}
        </Button>
      )}
      {options.length > 1 && (
        <div className="border-t pt-4">
          <p className="mb-2 text-sm font-semibold">Try another way</p>
          <ul className="flex flex-col gap-1">
            {options.map((o, i) =>
              i === index ? null : (
                <li key={o.factor}>
                  <button
                    type="button"
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                    onClick={() => {
                      setIndex(i);
                      setCode("");
                      setResult(null);
                      setNotice(null);
                    }}
                  >
                    {o.label}
                    {o.hint && o.factor !== "backup" ? ` (${o.hint})` : ""}
                  </button>
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
