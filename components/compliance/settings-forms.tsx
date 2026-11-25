"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { saveCompanyDetailsAction, saveRetentionAction } from "@/lib/compliance/actions";
import type { ActionResult } from "@/lib/validation/form-result";

type Field = { key: string; label: string; hint?: string; value: string };

/** A plain list of labelled inputs saved together. */
function FieldsForm({ fields, save, type, suffix }: { fields: Field[]; save: (v: Record<string, string>) => Promise<ActionResult>; type?: string; suffix?: string }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const fieldError = (k: string) => (result && !result.ok ? result.fieldErrors?.[k]?.[0] : undefined);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await save(values)));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <FormField key={f.key} id={`f-${f.key}`} label={suffix ? `${f.label} (${suffix})` : f.label} hint={f.hint} error={fieldError(f.key)}>
            <Input type={type} inputMode={type === "number" ? "numeric" : undefined} value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          </FormField>
        ))}
      </div>
      {result && <Alert variant={result.ok ? "success" : "danger"}>{result.ok ? result.message : result.error}</Alert>}
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function RetentionForm({ fields }: { fields: Field[] }) {
  return <FieldsForm fields={fields} save={saveRetentionAction} type="number" suffix="days" />;
}

export function CompanyForm({ fields }: { fields: Field[] }) {
  return <FieldsForm fields={fields} save={saveCompanyDetailsAction} />;
}
