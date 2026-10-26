"use client";

import Link from "next/link";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { resetPasswordAction } from "@/lib/auth/actions";
import { resetPasswordSchema } from "@/lib/validation/auth";

export function ResetPasswordForm({ email, token }: { email: string; token: string }) {
  const { form, onSubmit, pending, result } = useActionForm(resetPasswordSchema, resetPasswordAction, {
    email,
    token,
    password: "",
    confirmPassword: "",
  });
  const errors = form.formState.errors;

  if (result?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="success">{result.message}</Alert>
        <Button asChild>
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      <FormField id="password" label="New password" hint="At least 10 characters." error={errors.password?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
      </FormField>
      <FormField id="confirmPassword" label="Confirm new password" error={errors.confirmPassword?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
      </FormField>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
