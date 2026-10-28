"use client";

import { useState } from "react";
import { ActionAlert, useAction } from "@/components/admin/use-action";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { dismissReportsAction, moderateQuestionAction, moderateReviewAction, restoreListingAction, saveKeywordsAction, takeDownListingAction } from "@/lib/moderation/actions";

type Ref = { kind: "product" | "service"; id: string };

export function ListingDecision({ listing, takenDown, openReports }: { listing: Ref; takenDown: boolean; openReports: number }) {
  const { result, pending, run, fieldError } = useAction();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  if (takenDown) {
    return (
      <div className="flex flex-col gap-3">
        <ActionAlert result={result} />
        <p className="text-sm text-muted-foreground">Restoring puts the listing back if the seller has it published, and tells them.</p>
        <Button className="self-start" variant="outline" disabled={pending} onClick={() => run(() => restoreListingAction(listing))}>
          Restore listing
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <ActionAlert result={result} />
      <div className="flex flex-col gap-2">
        <FormField id="takedown-reason" label="Take it down" hint="The seller gets this reason by email and in their dashboard." error={fieldError("reason")}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: medicines that need a prescription can't be sold on TownMart." />
        </FormField>
        <Button className="self-start" variant="danger" disabled={pending || reason.trim().length < 10} onClick={() => run(() => takeDownListingAction({ ...listing, reason }))}>
          Take down and tell the seller
        </Button>
      </div>
      {openReports > 0 && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <FormField id="dismiss-note" label="Or dismiss the reports" hint="The listing stays live. The note is kept in the audit log." error={fieldError("note")}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Checked: allowed item, description is accurate." />
          </FormField>
          <Button className="self-start" variant="outline" disabled={pending || note.trim().length < 3} onClick={() => run(() => dismissReportsAction({ ...listing, note }))}>
            Dismiss {openReports} report{openReports === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ReviewDecision({ id, hidden }: { id: string; hidden: boolean }) {
  const { result, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <ActionAlert result={result} />
      <div className="flex flex-wrap gap-2">
        {!hidden && (
          <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => moderateReviewAction({ id, action: "hide" }))}>
            Hide review
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => moderateReviewAction({ id, action: "publish" }))}>
          {hidden ? "Show again" : "Keep it (clear the report)"}
        </Button>
      </div>
    </div>
  );
}

export function QuestionDecision({ id, hidden }: { id: string; hidden: boolean }) {
  const { result, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <ActionAlert result={result} />
      <Button size="sm" className="self-start" variant={hidden ? "outline" : "danger"} disabled={pending} onClick={() => run(() => moderateQuestionAction({ id, action: hidden ? "publish" : "hide" }))}>
        {hidden ? "Show again" : "Hide"}
      </Button>
    </div>
  );
}

export function KeywordsForm({ initial }: { initial: string[] }) {
  const { result, pending, run } = useAction();
  const [text, setText] = useState(initial.join("\n"));
  return (
    <div className="flex flex-col gap-3">
      <ActionAlert result={result} />
      <FormField id="keywords" label="Prohibited-items keywords" hint="One word or phrase per line. Matching is by whole word, ignoring capitals and plurals.">
        <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-sm" />
      </FormField>
      <Button className="self-start" disabled={pending} onClick={() => run(() => saveKeywordsAction({ text }))}>
        Save keywords
      </Button>
    </div>
  );
}
