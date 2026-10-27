"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { linkRequestToAccountAction, prepareExportAction, updateDataRequestAction } from "@/lib/compliance/actions";
import type { ActionResult } from "@/lib/validation/form-result";

export function RequestControls({ id, status, canExport, canLink }: { id: string; status: string; canExport: boolean; canLink: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {result && <Alert variant={result.ok ? "success" : "danger"}>{result.ok ? result.message : result.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {status === "open" && (
          <Button variant="outline" disabled={pending} onClick={() => run(() => updateDataRequestAction({ id, status: "in_progress" }))}>
            Start work
          </Button>
        )}
        {canExport && (
          <Button variant="outline" disabled={pending} onClick={() => run(() => prepareExportAction({ id }))}>
            Prepare their data export
          </Button>
        )}
        {canLink && (
          <Button variant="outline" disabled={pending} onClick={() => run(() => linkRequestToAccountAction({ id }))}>
            Link to the matching account
          </Button>
        )}
      </div>
      <FormField id="dsr-note" label="Reply to the requester" hint="Sent by email when you close the request, and shown in their Privacy Centre.">
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || !note.trim()} onClick={() => run(() => updateDataRequestAction({ id, status: "completed", note }))}>
          Mark done and reply
        </Button>
        <Button variant="danger" disabled={pending || !note.trim()} onClick={() => run(() => updateDataRequestAction({ id, status: "rejected", note }))}>
          Decline with reasons
        </Button>
      </div>
    </div>
  );
}
