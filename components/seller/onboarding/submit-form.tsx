"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { submitApplicationAction } from "@/lib/seller/actions";
import { agreementsSchema } from "@/lib/validation/seller";

export function SubmitForm({ ready, agreementVersion }: { ready: boolean; agreementVersion: string }) {
  const router = useRouter();
  const { form, onSubmit, pending, result } = useActionForm(
    agreementsSchema,
    async (values) => {
      const res = await submitApplicationAction(values);
      if (res.ok) router.push("/sell/onboarding");
      return res;
    },
    { acceptSellerAgreement: false as true, acceptDpa: false as true },
  );
  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {!ready && <Alert variant="warning">Finish the earlier steps before you submit.</Alert>}
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      <Checkbox
        id="acceptSellerAgreement"
        label={
          <>
            I accept the{" "}
            <Link href="/legal/seller-agreement" target="_blank" className="text-primary underline">
              Seller Agreement
            </Link>{" "}
            and the{" "}
            <Link href="/legal/prohibited-items" target="_blank" className="text-primary underline">
              Prohibited Items policy
            </Link>
          </>
        }
        hint={`Version ${agreementVersion}`}
        {...form.register("acceptSellerAgreement")}
      />
      {errors.acceptSellerAgreement && <p className="text-xs font-medium text-danger">{errors.acceptSellerAgreement.message}</p>}
      <Checkbox
        id="acceptDpa"
        label={
          <>
            I accept the{" "}
            <Link href="/legal/dpa" target="_blank" className="text-primary underline">
              Data Processing Agreement
            </Link>{" "}
            for customer data I receive through TownMart (NDPA 2023)
          </>
        }
        hint={`Version ${agreementVersion}`}
        {...form.register("acceptDpa")}
      />
      {errors.acceptDpa && <p className="text-xs font-medium text-danger">{errors.acceptDpa.message}</p>}
      <Button type="submit" disabled={pending || !ready} className="self-start">
        {pending ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}
