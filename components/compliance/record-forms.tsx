"use client";

import { useRouter } from "next/navigation";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LAWFUL_BASIS_LABELS } from "@/lib/compliance/labels";
import { saveActivityAction, saveDpiaAction, saveProcessorAction } from "@/lib/compliance/actions";
import { activitySchema, dpiaSchema, processorSchema } from "@/lib/validation/compliance";
import type { ActionResult } from "@/lib/validation/form-result";


function useSaved<T>(action: (v: T) => Promise<ActionResult>) {
  const router = useRouter();
  return async (v: T) => {
    const res = await action(v);
    if (res.ok) router.push("/admin/compliance/records");
    return res;
  };
}

const Err = ({ result }: { result: ActionResult<unknown> | null }) => (result && !result.ok ? <Alert variant="danger">{result.error}</Alert> : null);

export type ActivityValues = { id?: string; name: string; purpose: string; lawfulBasis: keyof typeof LAWFUL_BASIS_LABELS; dataSubjects: string; dataCategories: string; recipients: string; transfers: string; retention: string; security: string };

export function ActivityForm({ initial }: { initial: ActivityValues }) {
  const { form, onSubmit, pending, result } = useActionForm(activitySchema, useSaved(saveActivityAction), initial);
  const e = form.formState.errors;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Err result={result} />
      <FormField id="a-name" label="Activity" error={e.name?.message}>
        <Input {...form.register("name")} />
      </FormField>
      <FormField id="a-purpose" label="Purpose" error={e.purpose?.message}>
        <Textarea rows={2} {...form.register("purpose")} />
      </FormField>
      <FormField id="a-basis" label="Lawful basis (NDPA s.25)" error={e.lawfulBasis?.message}>
        <Select {...form.register("lawfulBasis")}>
          {Object.entries(LAWFUL_BASIS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="a-subjects" label="Whose data" hint="Comma-separated" error={e.dataSubjects?.message}>
        <Input {...form.register("dataSubjects")} />
      </FormField>
      <FormField id="a-categories" label="What data" hint="Comma-separated" error={e.dataCategories?.message}>
        <Input {...form.register("dataCategories")} />
      </FormField>
      <FormField id="a-recipients" label="Shared with" hint="Comma-separated" error={e.recipients?.message}>
        <Input {...form.register("recipients")} />
      </FormField>
      <FormField id="a-transfers" label="Transfers outside Nigeria and safeguards" error={e.transfers?.message}>
        <Textarea rows={2} {...form.register("transfers")} />
      </FormField>
      <FormField id="a-retention" label="How long it's kept" error={e.retention?.message}>
        <Input {...form.register("retention")} />
      </FormField>
      <FormField id="a-security" label="Security measures" error={e.security?.message}>
        <Textarea rows={2} {...form.register("security")} />
      </FormField>
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export type ProcessorValues = { id?: string; name: string; service: string; dataCategories: string; location: string; safeguards: string; dpaSignedAt: string; website: string; active: boolean };

export function ProcessorForm({ initial }: { initial: ProcessorValues }) {
  const { form, onSubmit, pending, result } = useActionForm(processorSchema, useSaved(saveProcessorAction), initial);
  const e = form.formState.errors;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Err result={result} />
      <FormField id="p-name" label="Company" error={e.name?.message}>
        <Input {...form.register("name")} />
      </FormField>
      <FormField id="p-service" label="What they do for TownMart" error={e.service?.message}>
        <Input {...form.register("service")} />
      </FormField>
      <FormField id="p-categories" label="Data they process" hint="Comma-separated" error={e.dataCategories?.message}>
        <Input {...form.register("dataCategories")} />
      </FormField>
      <FormField id="p-location" label="Where the data is processed" error={e.location?.message}>
        <Input {...form.register("location")} />
      </FormField>
      <FormField id="p-safeguards" label="Transfer safeguards" error={e.safeguards?.message}>
        <Textarea rows={2} {...form.register("safeguards")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="p-dpa" label="Data processing agreement signed" error={e.dpaSignedAt?.message}>
          <Input type="date" {...form.register("dpaSignedAt")} />
        </FormField>
        <FormField id="p-website" label="Website" error={e.website?.message}>
          <Input type="url" {...form.register("website")} />
        </FormField>
      </div>
      <Checkbox id="p-active" label="In use" {...form.register("active")} />
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export type DpiaValues = { id?: string; title: string; activityId: string; description: string; risks: string; mitigations: string; residualRisk: "low" | "medium" | "high"; status: "draft" | "approved" | "needs_review"; nextReviewAt: string };

export function DpiaForm({ initial, activities }: { initial: DpiaValues; activities: { id: string; name: string }[] }) {
  const { form, onSubmit, pending, result } = useActionForm(dpiaSchema, useSaved(saveDpiaAction), initial);
  const e = form.formState.errors;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Err result={result} />
      <FormField id="d-title" label="Assessment" error={e.title?.message}>
        <Input {...form.register("title")} />
      </FormField>
      <FormField id="d-activity" label="Processing activity" error={e.activityId?.message}>
        <Select {...form.register("activityId")}>
          <option value="">None</option>
          {activities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="d-description" label="What the processing involves" error={e.description?.message}>
        <Textarea rows={3} {...form.register("description")} />
      </FormField>
      <FormField id="d-risks" label="Risks to people" error={e.risks?.message}>
        <Textarea rows={3} {...form.register("risks")} />
      </FormField>
      <FormField id="d-mitigations" label="How the risks are reduced" error={e.mitigations?.message}>
        <Textarea rows={3} {...form.register("mitigations")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="d-residual" label="Remaining risk" error={e.residualRisk?.message}>
          <Select {...form.register("residualRisk")}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </FormField>
        <FormField id="d-status" label="Status" error={e.status?.message}>
          <Select {...form.register("status")}>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="needs_review">Needs review</option>
          </Select>
        </FormField>
        <FormField id="d-next" label="Next review" error={e.nextReviewAt?.message}>
          <Input type="date" {...form.register("nextReviewAt")} />
        </FormField>
      </div>
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
