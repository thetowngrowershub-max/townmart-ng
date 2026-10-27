"use client";

import { Turnstile } from "@/components/auth/turnstile";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { publicDataRequestAction } from "@/lib/privacy/actions";
import { DSR_TYPE_LABELS } from "@/lib/privacy/labels";
import { PUBLIC_REQUEST_TYPES, publicDataRequestSchema } from "@/lib/validation/privacy";

export function PublicRequestForm() {
  const { form, onSubmit, pending, result } = useActionForm(publicDataRequestSchema, publicDataRequestAction, { name: "", email: "", type: "access", details: "" });
  const errors = form.formState.errors;
  if (result?.ok) return <Alert variant="success">{result.message}</Alert>;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      <FormField id="dsr-name" label="Your name" error={errors.name?.message}>
        <Input autoComplete="name" {...form.register("name")} />
      </FormField>
      <FormField id="dsr-email" label="Email" hint="We send a link to check it's you. Use the address TownMart knows you by." error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </FormField>
      <FormField id="dsr-type" label="What would you like?" error={errors.type?.message}>
        <Select {...form.register("type")}>
          {PUBLIC_REQUEST_TYPES.map((t) => (
            <option key={t} value={t}>
              {DSR_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="dsr-details" label="Details (optional)" hint="For example an order number, or what should be corrected." error={errors.details?.message}>
        <Textarea rows={4} {...form.register("details")} />
      </FormField>
      <Turnstile onToken={(t) => form.setValue("turnstileToken", t)} />
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}
