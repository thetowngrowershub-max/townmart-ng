"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AddressFields, EMPTY_ADDRESS, type StateOption } from "@/components/checkout/address-fields";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addAddressAction, deleteAddressAction, setDefaultAddressAction } from "@/lib/account/actions";

export type AddressRow = { id: string; recipientName: string; lines: string[]; isDefault: boolean };

export function AddressBook({ addresses, states }: { addresses: AddressRow[]; states: StateOption[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(addresses.length === 0);
  const [draft, setDraft] = useState(EMPTY_ADDRESS);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string[]> }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setError(null);
        setErrors({});
        after?.();
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong.");
        setErrors(Object.fromEntries(Object.entries(res.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
      }
    });

  return (
    <div className="flex flex-col gap-4">
      {addresses.map((a) => (
        <Card key={a.id}>
          <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6 text-sm">
            <div>
              <p className="flex items-center gap-2 font-medium">
                {a.recipientName} {a.isDefault && <Badge>Default</Badge>}
              </p>
              {a.lines.map((l) => (
                <p key={l} className="text-muted-foreground">
                  {l}
                </p>
              ))}
            </div>
            <div className="flex gap-2">
              {!a.isDefault && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setDefaultAddressAction({ id: a.id }))}>
                  Make default
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteAddressAction({ id: a.id }))}>
                Remove
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {error && !adding && <Alert variant="danger">{error}</Alert>}
      {adding ? (
        <Card>
          <CardHeader>
            <CardTitle>New address</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => addAddressAction(draft),
                  () => {
                    setDraft(EMPTY_ADDRESS);
                    setAdding(false);
                  },
                );
              }}
            >
              <AddressFields value={draft} onChange={setDraft} states={states} errors={errors} />
              {error && <Alert variant="danger">{error}</Alert>}
              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save address"}
                </Button>
                {addresses.length > 0 && (
                  <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" className="self-start" onClick={() => setAdding(true)}>
          Add an address
        </Button>
      )}
    </div>
  );
}
