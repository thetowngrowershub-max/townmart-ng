"use client";

import { useState } from "react";
import { ActionAlert, useAction } from "@/components/admin/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { STAFF_FLAGS } from "@/lib/staff/flags";
import { acceptInvitationAction, inviteStaffAction, removeStaffAction, resendInvitationAction, revokeInvitationAction, updateStaffPermissionsAction } from "@/lib/staff/actions";

function Flags({ prefix, value, onChange }: { prefix: string; value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {STAFF_FLAGS.map((f) => (
        <Checkbox key={f.key} id={`${prefix}-${f.key}`} label={f.label} hint={f.hint} checked={Boolean(value[f.key])} onChange={(e) => onChange({ ...value, [f.key]: e.target.checked })} />
      ))}
    </div>
  );
}

export function InviteStaffForm() {
  const { result, pending, run, fieldError } = useAction();
  const [email, setEmail] = useState("");
  const [flags, setFlags] = useState<Record<string, boolean>>({ orders: true });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => inviteStaffAction({ email, permissions: flags }), () => setEmail(""));
      }}
    >
      <ActionAlert result={result} />
      <FormField id="invite-email" label="Their email" error={fieldError("email")}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
      </FormField>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">What they can work on</legend>
        <Flags prefix="invite" value={flags} onChange={setFlags} />
        {fieldError("permissions") && <p className="text-xs font-medium text-danger">{fieldError("permissions")}</p>}
      </fieldset>
      <p className="text-xs text-muted-foreground">Only you can see payouts and earnings, change store settings, or manage staff.</p>
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Sending…" : "Send invitation"}
      </Button>
    </form>
  );
}

export function StaffMemberControls({ staffId, name, initial }: { staffId: string; name: string; initial: Record<string, boolean> }) {
  const { result, pending, run } = useAction();
  const [flags, setFlags] = useState(initial);
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <ActionAlert result={result} />
      {editing && <Flags prefix={staffId} value={flags} onChange={setFlags} />}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button size="sm" disabled={pending} onClick={() => run(() => updateStaffPermissionsAction({ staffId, permissions: flags }), () => setEditing(false))}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Change access
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(`Remove ${name} from your team? They lose access straight away.`) && run(() => removeStaffAction({ staffId }))}>
          Remove
        </Button>
      </div>
    </div>
  );
}

export function InvitationControls({ invitationId }: { invitationId: string }) {
  const { result, pending, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="flex gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => resendInvitationAction({ invitationId }))}>
          Send again
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Cancel this invitation? The link stops working.") && run(() => revokeInvitationAction({ invitationId }))}>
          Cancel
        </Button>
      </span>
      {result && <span className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-danger"}>{result.ok ? result.message : result.error}</span>}
    </span>
  );
}

export function AcceptInvitationButton({ token }: { token: string }) {
  const { result, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-3">
      <ActionAlert result={result} />
      {!result?.ok && (
        <Button disabled={pending} onClick={() => run(() => acceptInvitationAction({ token }), () => window.location.assign("/dashboard"))}>
          {pending ? "Joining…" : "Accept and join"}
        </Button>
      )}
    </div>
  );
}
