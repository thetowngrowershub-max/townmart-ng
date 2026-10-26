"use client";

import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Bank } from "@/lib/payments/banks";
import { resolveBankAccountAction, savePayoutAccountAction } from "@/lib/seller/actions";
import { payoutAccountSchema } from "@/lib/validation/seller";

export function PayoutForm({
  banks,
  current,
  next = "/sell/onboarding",
}: {
  banks: Bank[];
  current: { bankName: string; accountName: string; last4: string } | null;
  next?: string;
}) {
  const router = useRouter();
  const [resolved, setResolved] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolving, startResolving] = useTransition();
  const { form, onSubmit, pending, result } = useActionForm(
    payoutAccountSchema,
    async (values) => {
      const res = await savePayoutAccountAction(values);
      if (res.ok) {
        router.push(next);
        router.refresh();
      }
      return res;
    },
    { bankCode: "", accountNumber: "" },
  );
  const errors = form.formState.errors;

  const lookUp = () => {
    const values = form.getValues();
    setResolved(null);
    setResolveError(null);
    if (!values.bankCode || !/^\d{10}$/.test(values.accountNumber)) return;
    startResolving(async () => {
      const res = await resolveBankAccountAction(values);
      if (res.ok) setResolved(res.data!.accountName);
      else setResolveError(res.error);
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {current && (
        <Alert variant="success">
          Payouts go to {current.accountName}, {current.bankName} ••••{current.last4}. Enter a new account below to change it.
        </Alert>
      )}
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      <FormField id="bankCode" label="Bank" error={errors.bankCode?.message}>
        <Select {...form.register("bankCode", { onChange: lookUp })}>
          <option value="">Choose your bank…</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="accountNumber" label="Account number (NUBAN)" error={errors.accountNumber?.message ?? resolveError ?? undefined}>
        <Input inputMode="numeric" maxLength={10} autoComplete="off" {...form.register("accountNumber", { onChange: lookUp })} />
      </FormField>
      <div aria-live="polite" className="min-h-6 text-sm">
        {resolving && <span className="text-muted-foreground">Checking with the bank…</span>}
        {resolved && (
          <span className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-4 text-success" aria-hidden /> {resolved}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        The account name should match your business or your own name. We keep only the last 4 digits; the full number is held by our payment
        provider, Paystack.
      </p>
      <Button type="submit" disabled={pending || !resolved} className="self-start">
        {pending ? "Saving…" : "Use this account"}
      </Button>
    </form>
  );
}
