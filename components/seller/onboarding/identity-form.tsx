"use client";

import { useRouter } from "next/navigation";
import { useActionForm } from "@/components/auth/use-action-form";
import { PrivateFileInput, type PrivateFile } from "@/components/uploads/private-file-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { submitKycAction } from "@/lib/seller/actions";
import { kycSchema } from "@/lib/validation/seller";
import { useState } from "react";

const DOC_TYPES = [
  { value: "nin_slip", label: "NIN slip" },
  { value: "drivers_licence", label: "Driver's licence" },
  { value: "intl_passport", label: "International passport" },
  { value: "voters_card", label: "Voter's card" },
  { value: "cac_certificate", label: "CAC certificate" },
] as const;

export function IdentityForm({ resubmitting }: { resubmitting: boolean }) {
  const router = useRouter();
  const [files, setFiles] = useState<PrivateFile[]>([]);
  const { form, onSubmit, pending, result } = useActionForm(
    kycSchema,
    async (values) => {
      const res = await submitKycAction(values);
      if (res.ok) router.push("/sell/onboarding");
      return res;
    },
    { idDocumentType: undefined, tmpKeys: [] },
  );
  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <Alert variant="info">
        Your documents are stored encrypted in a private bucket. Only TownMart&apos;s verification team can open them, and every view is logged. We
        never ask for or store your BVN or NIN number.
      </Alert>
      {resubmitting && <Alert variant="warning">Uploading new documents replaces the ones you sent before.</Alert>}
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      <FormField id="idDocumentType" label="Document type" error={errors.idDocumentType?.message}>
        <Select {...form.register("idDocumentType")} defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {DOC_TYPES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
      </FormField>
      <PrivateFileInput
        kind="kyc"
        label="Upload the document (front and back if it has two sides)"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        max={3}
        value={files}
        error={errors.tmpKeys?.message}
        onChange={(next) => {
          setFiles(next);
          form.setValue(
            "tmpKeys",
            next.map((f) => f.tmpKey),
            { shouldValidate: form.formState.isSubmitted },
          );
        }}
      />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Submitting…" : "Submit documents"}
      </Button>
    </form>
  );
}
