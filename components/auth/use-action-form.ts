"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm, type DefaultValues, type FieldValues, type Path, type Resolver } from "react-hook-form";
import type { z } from "zod";
import type { ActionResult } from "@/lib/validation/form-result";

/**
 * React Hook Form + Zod on the client, the same Zod schema again inside the
 * Server Action. Server field errors are mapped back onto the form.
 */
export function useActionForm<TSchema extends z.ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
  action: (values: z.input<TSchema>) => Promise<ActionResult<unknown>>,
  defaultValues: DefaultValues<z.input<TSchema>>,
) {
  const form = useForm<z.input<TSchema>, unknown, z.output<TSchema>>({
    // zodResolver's generics can't follow a generic schema parameter.
    resolver: zodResolver(schema) as unknown as Resolver<z.input<TSchema>, unknown, z.output<TSchema>>,
    defaultValues,
  });
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);

  const onSubmit = form.handleSubmit((_parsed) => {
    // Send the raw input: the action re-validates with the same schema.
    const raw = form.getValues();
    setResult(null);
    startTransition(async () => {
      const res = await action(raw);
      // A successful action may redirect, in which case we never get here.
      setResult(res);
      if (!res.ok && res.fieldErrors) {
        for (const [field, messages] of Object.entries(res.fieldErrors)) {
          form.setError(field as Path<z.input<TSchema>>, { message: messages[0] });
        }
      }
    });
  });

  return { form, onSubmit, pending, result };
}
