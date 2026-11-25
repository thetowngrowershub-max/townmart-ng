"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useActionForm } from "@/components/auth/use-action-form";
import { OPEN_COOKIE_SETTINGS } from "@/components/consent/consent-banner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { requestDeletionAction, requestExportAction, submitPrivacyRequestAction, updateNameAction } from "@/lib/privacy/actions";
import { deletionSchema, privacyRequestSchema, QUEUED_REQUEST_TYPES, rectifyNameSchema } from "@/lib/validation/privacy";
import type { ActionResult } from "@/lib/validation/form-result";

function Result({ result }: { result: ActionResult<unknown> | null }) {
  if (!result) return null;
  return result.ok ? (result.message ? <Alert variant="success">{result.message}</Alert> : null) : <Alert variant="danger">{result.error}</Alert>;
}

export function RequestExportButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Result result={result} />
      <Button
        className="self-start"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            setResult(await requestExportAction());
            router.refresh();
          })
        }
      >
        {pending ? "Asking…" : disabled ? "Preparing your data…" : "Download my data"}
      </Button>
    </div>
  );
}

export function NameForm({ name }: { name: string }) {
  const { form, onSubmit, pending, result } = useActionForm(rectifyNameSchema, updateNameAction, { name });
  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <FormField id="privacy-name" label="Your name" error={form.formState.errors.name?.message}>
            <Input autoComplete="name" {...form.register("name")} />
          </FormField>
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
      <Result result={result} />
    </div>
  );
}

const QUEUED_LABELS: Record<(typeof QUEUED_REQUEST_TYPES)[number], string> = {
  rectification: "Correct something about me",
  restriction: "Restrict how my data is used",
  objection: "Object to how my data is used",
  withdraw_consent: "Withdraw a consent I gave",
  other: "Something else",
};

export function PrivacyRequestForm() {
  const { form, onSubmit, pending, result } = useActionForm(privacyRequestSchema, submitPrivacyRequestAction, { type: "rectification", details: "" });
  const errors = form.formState.errors;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Result result={result} />
      <FormField id="privacy-type" label="What would you like us to do?" error={errors.type?.message}>
        <Select {...form.register("type")}>
          {QUEUED_REQUEST_TYPES.map((t) => (
            <option key={t} value={t}>
              {QUEUED_LABELS[t]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="privacy-details" label="Details" hint="What should change, or what you object to, and why." error={errors.details?.message}>
        <Textarea rows={4} {...form.register("details")} />
      </FormField>
      <Button type="submit" variant="outline" className="self-start" disabled={pending}>
        {pending ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}

export function CookieChoiceButton() {
  return (
    <Button variant="outline" size="sm" className="self-start" onClick={() => window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS))}>
      Change cookie settings
    </Button>
  );
}

export function DeleteAccountForm({ graceDays }: { graceDays: number }) {
  const { form, onSubmit, pending, result } = useActionForm(deletionSchema, requestDeletionAction, { confirm: "" as "DELETE", reason: "" });
  const errors = form.formState.errors;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      <FormField id="delete-reason" label="Why are you leaving? (optional)" error={errors.reason?.message}>
        <Textarea rows={2} {...form.register("reason")} />
      </FormField>
      <FormField id="delete-confirm" label="Type DELETE to confirm" hint={`You'll be signed out. Sign in again within ${graceDays} days to cancel.`} error={errors.confirm?.message}>
        <Input autoComplete="off" {...form.register("confirm")} />
      </FormField>
      <Button type="submit" variant="danger" className="self-start" disabled={pending}>
        {pending ? "Deleting…" : "Delete my account"}
      </Button>
    </form>
  );
}
