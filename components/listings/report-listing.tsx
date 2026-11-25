"use client";

import { Flag } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { REPORT_REASON_LABELS, SHOPPER_REPORT_REASONS } from "@/lib/moderation/labels";
import { reportListingAction } from "@/lib/moderation/actions";

/** "Report this listing": a reason and optional details, sent to TownMart's moderation queue. */
export function ReportListing({ kind, id, signedIn, returnTo }: { kind: "product" | "service"; id: string; signedIn: boolean; returnTo: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof SHOPPER_REPORT_REASONS)[number] | "">("");
  const [details, setDetails] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (msg?.ok) return <p className="text-sm text-muted-foreground">{msg.text}</p>;
  if (!open)
    return (
      <button type="button" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline" onClick={() => setOpen(true)}>
        <Flag className="size-3.5" aria-hidden /> Report this listing
      </button>
    );
  if (!signedIn)
    return (
      <p className="text-sm text-muted-foreground">
        <Link href={`/auth/sign-in?next=${encodeURIComponent(returnTo)}`} className="font-medium text-primary underline">
          Sign in
        </Link>{" "}
        to report this listing.
      </p>
    );
  return (
    <form
      className="flex max-w-md flex-col gap-2 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason) return;
        start(async () => {
          const res = await reportListingAction({ kind, id, reason, details });
          setMsg({ ok: res.ok, text: res.ok ? (res.message ?? "Reported.") : res.error });
        });
      }}
    >
      <label htmlFor={`report-reason-${id}`} className="text-sm font-medium">
        What&apos;s wrong with this listing?
      </label>
      <Select id={`report-reason-${id}`} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} required>
        <option value="">Choose a reason</option>
        {SHOPPER_REPORT_REASONS.map((r) => (
          <option key={r} value={r}>
            {REPORT_REASON_LABELS[r]}
          </option>
        ))}
      </Select>
      <label htmlFor={`report-details-${id}`} className="text-sm font-medium">
        Anything else we should know? <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <Textarea id={`report-details-${id}`} rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
      {msg && !msg.ok && <p className="text-sm text-danger">{msg.text}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !reason}>
          Send report
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
