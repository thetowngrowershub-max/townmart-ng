"use client";

import Link from "next/link";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { signInAction } from "@/lib/auth/actions";
import { signInSchema } from "@/lib/validation/auth";

export function SignInForm({ next }: { next?: string }) {
  const { form, onSubmit, pending, result } = useActionForm(signInSchema, signInAction, { email: "", password: "", next });
  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </FormField>
      <FormField id="password" label="Password" error={errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...form.register("password")} />
      </FormField>
      <div className="-mt-2 text-right text-sm">
        <Link href="/auth/forgot-password" className="text-primary hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
