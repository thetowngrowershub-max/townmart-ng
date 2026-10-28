"use client";

import { useState } from "react";
import { ActionAlert, useAction } from "@/components/admin/use-action";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { restoreUserAction, setRoleAction, signOutEverywhereAction, suspendUserAction } from "@/lib/admin/user-actions";

/** Suspend or restore, and sign out everywhere. */
export function AccountControls({ userId, status, self }: { userId: string; status: string; self: boolean }) {
  const { result, pending, run, fieldError } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <ActionAlert result={result} />
      <div className="flex flex-wrap gap-2">
        {status === "active" && !self && !open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Suspend account
          </Button>
        )}
        {status === "suspended" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => restoreUserAction({ userId }))}>
            Restore account
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Sign this account out on every device?") && run(() => signOutEverywhereAction({ userId }))}>
          Sign out everywhere
        </Button>
      </div>
      {open && (
        <form
          className="flex flex-col gap-3 rounded-xl border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => suspendUserAction({ userId, reason }), () => setOpen(false));
          }}
        >
          <FormField id="suspend-reason" label="Why are you suspending this account?" hint="Kept in the audit log. They can't sign in until restored." error={fieldError("reason")}>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="danger" disabled={pending}>
              {pending ? "Suspending…" : "Suspend and sign out"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

const ROLE_COPY = {
  admin: { label: "Admin", hint: "Runs the admin console: sellers, orders, money, moderation, content." },
  super_admin: { label: "Super admin", hint: "Everything an admin can do, plus roles and the full audit log." },
} as const;

/** Grant or remove TownMart staff roles. Super admins only. */
export function RoleControls({ userId, roles }: { userId: string; roles: string[] }) {
  const { result, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-3">
      <ActionAlert result={result} />
      <ul className="flex flex-col divide-y rounded-xl border">
        {(Object.keys(ROLE_COPY) as (keyof typeof ROLE_COPY)[]).map((role) => {
          const has = roles.includes(role);
          return (
            <li key={role} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{ROLE_COPY[role].label}</p>
                <p className="text-xs text-muted-foreground">{ROLE_COPY[role].hint}</p>
              </div>
              <Button
                size="sm"
                variant={has ? "ghost" : "outline"}
                disabled={pending}
                onClick={() => window.confirm(has ? `Remove ${ROLE_COPY[role].label}? They'll be signed out.` : `Make them ${ROLE_COPY[role].label}?`) && run(() => setRoleAction({ userId, role, grant: !has }))}
              >
                {has ? "Remove" : "Grant"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
