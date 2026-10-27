"use client";

import { useRouter } from "next/navigation";
import { Controller } from "react-hook-form";
import { useActionForm } from "@/components/auth/use-action-form";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { publishLegalDocumentAction } from "@/lib/compliance/actions";
import { legalPublishSchema } from "@/lib/validation/compliance";

export type LegalEditorValues = { slug: string; title: string; summary: string; bodyHtml: string; effectiveAt: string; changeNote: string; isTemplate: boolean };

/** Publishing makes a new version; the page shows it from its effective date and keeps the old ones. */
export function LegalEditor({ initial }: { initial: LegalEditorValues }) {
  const router = useRouter();
  const { form, onSubmit, pending, result } = useActionForm(
    legalPublishSchema,
    async (v) => {
      const res = await publishLegalDocumentAction(v);
      if (res.ok) router.refresh();
      return res;
    },
    initial,
  );
  const e = form.formState.errors;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {result && <Alert variant={result.ok ? "success" : "danger"}>{result.ok ? result.message : result.error}</Alert>}
      <FormField id="l-title" label="Title" error={e.title?.message}>
        <Input {...form.register("title")} />
      </FormField>
      <FormField id="l-summary" label="Summary" hint="One or two sentences shown above the text." error={e.summary?.message}>
        <Textarea rows={2} {...form.register("summary")} />
      </FormField>
      <div className="flex flex-col gap-2">
        <Label htmlFor="l-body">Text</Label>
        <p id="l-body-hint" className="text-xs text-muted-foreground">
          Use {"{{company.legal_name}}"}, {"{{company.dpo_email}}"} and the other company details, or {"{{retention.logs}}"} and the other retention periods: they&apos;re filled in when the page is shown.
        </p>
        <Controller
          control={form.control}
          name="bodyHtml"
          render={({ field }) => <RichTextEditor id="l-body" value={field.value} onChange={field.onChange} invalid={!!e.bodyHtml} describedBy="l-body-hint" />}
        />
        {e.bodyHtml && <p className="text-xs font-medium text-danger">{e.bodyHtml.message}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="l-effective" label="Takes effect (Lagos time)" hint="A future date publishes it ahead; the current version stays until then." error={e.effectiveAt?.message}>
          <Input type="datetime-local" {...form.register("effectiveAt")} />
        </FormField>
        <FormField id="l-note" label="What changed" hint="Shown in the version history." error={e.changeNote?.message}>
          <Input {...form.register("changeNote")} />
        </FormField>
      </div>
      <Checkbox id="l-template" label="Still a template" hint="Untick once a Nigerian lawyer or the DPO has reviewed this text. The page shows a notice while it's ticked." {...form.register("isTemplate")} />
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Publishing…" : "Publish new version"}
      </Button>
    </form>
  );
}
