"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { sendTwoFactorSetupCodeAction, setTwoFactorAction } from "@/lib/auth/two-factor-actions";
import type { ActionResult } from "@/lib/validation/form-result";

/** Turns two-step sign-in on or off, confirmed with a code sent to the verified phone. */
export function TwoFactorSetting({ enabled, hasPhone }: { enabled: boolean; hasPhone: boolean }) {
  const router = useRouter();
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  if (!hasPhone) return <p className="text-sm text-muted-foreground">Verify a phone number above to turn this on.</p>;
  return (
    <div className="flex max-w-sm flex-col gap-3">
      <p className="text-sm">
        Two-step sign-in is <strong>{enabled ? "on" : "off"}</strong>.{" "}
        {enabled ? "Signing in with your password also needs a code sent to your phone." : "Add a code sent to your phone to every password sign-in."}
      </p>
      {result && <Alert variant={result.ok ? "success" : "danger"}>{result.ok ? result.message : result.error}</Alert>}
      {!codeSent ? (
        <Button
          variant={enabled ? "outline" : "default"}
          className="self-start"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await sendTwoFactorSetupCodeAction();
              setResult(res);
              if (res.ok) setCodeSent(true);
            })
          }
        >
          {enabled ? "Turn off" : "Turn on"}
        </Button>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await setTwoFactorAction({ code, enable: !enabled });
              setResult(res);
              if (res.ok) {
                setCodeSent(false);
                setCode("");
                router.refresh();
              }
            });
          }}
        >
          <FormField id="two-factor-code" label="Code from your text message">
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          </FormField>
          <Button type="submit" className="self-start" disabled={pending}>
            {enabled ? "Confirm and turn off" : "Confirm and turn on"}
          </Button>
        </form>
      )}
    </div>
  );
}
