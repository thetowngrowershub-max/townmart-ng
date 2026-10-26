"use client";

import Link from "next/link";
import { Turnstile } from "@/components/auth/turnstile";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { signUpAction } from "@/lib/auth/actions";
import { signUpSchema } from "@/lib/validation/auth";

export function SignUpForm() {
  const { form, onSubmit, pending, result } = useActionForm(signUpSchema, signUpAction, {
    name: "",
    email: "",
    password: "",
  });
  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      <FormField id="name" label="Full name" error={errors.name?.message}>
        <Input autoComplete="name" {...form.register("name")} />
      </FormField>
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </FormField>
      <FormField id="password" label="Password" hint="At least 10 characters." error={errors.password?.message}>
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
      </FormField>
      <Turnstile onToken={(t) => form.setValue("turnstileToken", t)} />
      <p className="text-xs text-muted-foreground">
        By creating an account you agree to our{" "}
        <Link href="/legal/terms" className="text-primary underline">
          Terms of Use
        </Link>{" "}
        and confirm you have read our{" "}
        <Link href="/legal/privacy" className="text-primary underline">
          Privacy Policy
        </Link>
        . You must be 18 or older.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
