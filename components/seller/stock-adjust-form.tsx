"use client";

import { useRouter } from "next/navigation";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { adjustStockAction } from "@/lib/catalogue/actions";
import { stockAdjustmentSchema } from "@/lib/validation/catalogue";

export function StockAdjustForm({ variants }: { variants: { id: string; label: string; stock: string }[] }) {
  const router = useRouter();
  const { form, onSubmit, pending, result } = useActionForm(
    stockAdjustmentSchema,
    async (values) => {
      const res = await adjustStockAction(values);
      if (res.ok) {
        form.reset({ variantId: values.variantId, change: "", note: "" });
        router.refresh();
      }
      return res;
    },
    { variantId: variants[0]?.id ?? "", change: "", note: "" },
  );
  const errors = form.formState.errors;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {result && (result.ok ? <Alert variant="success">{result.message}</Alert> : <Alert variant="danger">{result.error}</Alert>)}
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <FormField id="variantId" label="Variant" error={errors.variantId?.message}>
          <Select {...form.register("variantId")}>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} (now {v.stock})
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="change" label="Change" hint="e.g. 20 or -3" error={errors.change?.message}>
          <Input inputMode="decimal" {...form.register("change")} />
        </FormField>
      </div>
      <FormField id="note" label="Reason" hint="e.g. New delivery from supplier, damaged in store" error={errors.note?.message}>
        <Input {...form.register("note")} />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Adjust stock"}
      </Button>
    </form>
  );
}
