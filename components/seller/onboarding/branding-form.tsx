"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useActionForm } from "@/components/auth/use-action-form";
import { SingleImageInput } from "@/components/uploads/single-image-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { saveBrandingAction } from "@/lib/seller/actions";
import { brandingSchema } from "@/lib/validation/seller";

type Img = { key: string; url: string } | null;

export function BrandingForm({
  initial,
  next = "/sell/onboarding",
  submitLabel = "Save and continue",
}: {
  initial: { description: string; logo: Img; banner: Img };
  next?: string;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [logo, setLogo] = useState<Img>(initial.logo);
  const [banner, setBanner] = useState<Img>(initial.banner);
  const { form, onSubmit, pending, result } = useActionForm(
    brandingSchema,
    async (values) => {
      const res = await saveBrandingAction(values);
      if (res.ok) {
        router.push(next);
        router.refresh();
      }
      return res;
    },
    { description: initial.description, logoKey: initial.logo?.key ?? "", bannerKey: initial.banner?.key ?? "" },
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {result?.ok && next === "" && <Alert variant="success">Saved.</Alert>}
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      <SingleImageInput
        label="Logo"
        hint="Square works best. At least 256 × 256 pixels."
        purpose="logo"
        value={logo}
        onChange={(v) => {
          setLogo(v);
          form.setValue("logoKey", v?.key ?? "");
        }}
      />
      <SingleImageInput
        label="Banner"
        hint="Wide image, 3:1, at least 1200 × 400 pixels."
        purpose="banner"
        value={banner}
        onChange={(v) => {
          setBanner(v);
          form.setValue("bannerKey", v?.key ?? "");
        }}
      />
      <FormField id="description" label="About your business" hint="Shown on your store page." error={form.formState.errors.description?.message}>
        <Textarea rows={5} {...form.register("description")} />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
