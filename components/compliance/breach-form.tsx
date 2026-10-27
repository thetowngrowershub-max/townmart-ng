"use client";

import { useRouter } from "next/navigation";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveBreachAction } from "@/lib/compliance/actions";
import { breachSchema } from "@/lib/validation/compliance";

export type BreachFormValues = {
  id?: string;
  title: string;
  description: string;
  detectedAt: string;
  awareAt: string;
  dataCategories: string;
  subjectsAffected: string;
  risk: "low" | "medium" | "high";
  actions: string;
  status: "open" | "contained" | "closed";
  ndpcNotifiedAt: string;
  ndpcReference: string;
  subjectNotice: "not_required" | "pending" | "sent";
  subjectsNotifiedAt: string;
};

export function BreachForm({ initial }: { initial: BreachFormValues }) {
  const router = useRouter();
  const { form, onSubmit, pending, result } = useActionForm(
    breachSchema,
    async (values) => {
      const res = await saveBreachAction(values);
      if (res.ok && !initial.id && res.data) router.push(`/admin/compliance/breaches/${res.data.id}`);
      else if (res.ok) router.refresh();
      return res;
    },
    initial,
  );
  const e = form.formState.errors;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {result && <Alert variant={result.ok ? "success" : "danger"}>{result.ok ? result.message : result.error}</Alert>}
      <FormField id="b-title" label="Title" error={e.title?.message}>
        <Input {...form.register("title")} />
      </FormField>
      <FormField id="b-description" label="What happened" error={e.description?.message}>
        <Textarea rows={4} {...form.register("description")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="b-detected" label="Detected (Lagos time)" error={e.detectedAt?.message}>
          <Input type="datetime-local" {...form.register("detectedAt")} />
        </FormField>
        <FormField id="b-aware" label="TownMart became aware" hint="The 72-hour NDPC clock starts here." error={e.awareAt?.message}>
          <Input type="datetime-local" {...form.register("awareAt")} />
        </FormField>
      </div>
      <FormField id="b-categories" label="Data involved" hint="Comma-separated, e.g. email, phone, delivery address" error={e.dataCategories?.message}>
        <Input {...form.register("dataCategories")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="b-subjects" label="People affected" hint="Leave blank if not known yet." error={e.subjectsAffected?.message}>
          <Input inputMode="numeric" {...form.register("subjectsAffected")} />
        </FormField>
        <FormField id="b-risk" label="Risk to people" error={e.risk?.message}>
          <Select {...form.register("risk")}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </FormField>
      </div>
      <FormField id="b-actions" label="Actions taken" error={e.actions?.message}>
        <Textarea rows={3} {...form.register("actions")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="b-ndpc" label="NDPC notified (Lagos time)" error={e.ndpcNotifiedAt?.message}>
          <Input type="datetime-local" {...form.register("ndpcNotifiedAt")} />
        </FormField>
        <FormField id="b-ndpc-ref" label="NDPC reference" error={e.ndpcReference?.message}>
          <Input {...form.register("ndpcReference")} />
        </FormField>
        <FormField id="b-notice" label="Telling the people affected" error={e.subjectNotice?.message}>
          <Select {...form.register("subjectNotice")}>
            <option value="pending">To do</option>
            <option value="sent">Sent</option>
            <option value="not_required">Not required (low risk)</option>
          </Select>
        </FormField>
        <FormField id="b-notified" label="People told (Lagos time)" error={e.subjectsNotifiedAt?.message}>
          <Input type="datetime-local" {...form.register("subjectsNotifiedAt")} />
        </FormField>
      </div>
      <FormField id="b-status" label="Status" error={e.status?.message}>
        <Select {...form.register("status")}>
          <option value="open">Open</option>
          <option value="contained">Contained</option>
          <option value="closed">Closed</option>
        </Select>
      </FormField>
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Saving…" : initial.id ? "Save changes" : "Log breach"}
      </Button>
    </form>
  );
}
