"use client";

import { Loader2, Play, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DisputeThread } from "@/components/refunds/dispute-thread";
import { RefundDecision } from "@/components/refunds/seller-refund-decision";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  adminApproveRefundAction,
  adminDisputeMessageAction,
  adminRefundAction,
  adminRejectRefundAction,
  resolveDisputeAction,
  retryRefundAction,
  runMoneyJobsAction,
} from "@/lib/admin/finance-actions";
import type { DisputeView } from "@/lib/refunds/view";
import type { ActionResult } from "@/lib/validation/form-result";

type Item = { orderItemId: string; title: string; qty: string; product: boolean };

function useResult() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.ok ? (res.message ?? "Done.") : (res.error ?? "Couldn't save.") });
      setFieldErrors(res.ok ? {} : (res.fieldErrors ?? {}));
      if (res.ok) router.refresh();
    });
  const out = <div aria-live="polite">{msg && <Alert variant={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}</div>;
  return { run, pending, fieldErrors, out };
}

export function AdminRefundDecision(props: { refundId: string; maxNaira: string; items: Item[] }) {
  return <RefundDecision {...props} who="admin" approve={adminApproveRefundAction} reject={adminRejectRefundAction} />;
}

const ADMIN_REASONS = [
  ["not_received", "Never arrived"],
  ["damaged", "Arrived damaged"],
  ["wrong_item", "Wrong item"],
  ["not_as_described", "Not as described"],
  ["changed_mind", "Customer changed their mind"],
  ["provider_no_show", "Provider didn't turn up"],
  ["cancelled_by_seller", "Seller can't fulfil it"],
  ["other", "Something else"],
] as const;

/** A refund TownMart starts on one seller's part of an order. */
export function AdminRefundForm({ sellerOrderId, leftNaira, items }: { sellerOrderId: string; leftNaira: string; items: Item[] }) {
  const { run, pending, fieldErrors, out } = useResult();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [restock, setRestock] = useState<string[]>([]);
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Refund this seller&apos;s part
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => adminRefundAction({ sellerOrderId, amount, reason, note, restock }));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`amt-${sellerOrderId}`}>Amount (₦)</Label>
          <Input id={`amt-${sellerOrderId}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`${leftNaira} (everything left)`} />
          {fieldErrors.amount && <p className="text-sm text-danger">{fieldErrors.amount[0]}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`why-${sellerOrderId}`}>Reason</Label>
          <Select id={`why-${sellerOrderId}`} value={reason} onChange={(e) => setReason(e.target.value)} required>
            <option value="">Choose</option>
            {ADMIN_REASONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {items.some((i) => i.product) && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Put back on sale</legend>
          {items
            .filter((i) => i.product)
            .map((i) => (
              <Checkbox key={i.orderItemId} id={`rs-${i.orderItemId}`} label={`${i.qty} × ${i.title}`} checked={restock.includes(i.orderItemId)} onChange={(e) => setRestock(e.target.checked ? [...restock, i.orderItemId] : restock.filter((x) => x !== i.orderItemId))} />
            ))}
        </fieldset>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor={`note-${sellerOrderId}`}>Note (customer and seller see it; also kept in the audit log)</Label>
        <Textarea id={`note-${sellerOrderId}`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        {fieldErrors.note && <p className="text-sm text-danger">{fieldErrors.note[0]}</p>}
      </div>
      <p className="text-xs text-muted-foreground">Empty amount refunds everything left, including delivery. The refund is sent straight away and comes off the seller&apos;s balance.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />} Refund
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {out}
    </form>
  );
}

export function RetryRefundButton({ refundId }: { refundId: string }) {
  const { run, pending, out } = useResult();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryRefundAction({ refundId }))}>
        <RotateCw aria-hidden /> Send again
      </Button>
      {out}
    </div>
  );
}

export function RunJobButton({ job, label }: { job: "escrow" | "payouts"; label: string }) {
  const { run, pending, out } = useResult();
  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => runMoneyJobsAction({ job }))}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />} {label}
      </Button>
      {out}
    </div>
  );
}

export function AdminDispute({ dispute }: { dispute: DisputeView }) {
  return <DisputeThread dispute={dispute} me="admin" send={dispute.status === "open" ? (body) => adminDisputeMessageAction({ disputeId: dispute.id, body }) : undefined} />;
}

export function ResolveDispute({ disputeId, left, payOnDelivery }: { disputeId: string; left: string; payOnDelivery: boolean }) {
  const { run, pending, fieldErrors, out } = useResult();
  const [outcome, setOutcome] = useState<"refund_full" | "refund_partial" | "no_refund">(payOnDelivery ? "no_refund" : "refund_full");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm("Record this decision? Both sides are told, and any refund is sent straight away.")) return;
        run(() => resolveDisputeAction({ disputeId, outcome, amount: outcome === "refund_partial" ? amount : "", note }));
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Decision</legend>
        {(
          [
            ["refund_full", `Full refund of what's left (${left})`],
            ["refund_partial", "Part refund"],
            ["no_refund", "No refund"],
          ] as const
        ).map(([v, l]) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <input type="radio" name="outcome" value={v} checked={outcome === v} disabled={payOnDelivery && v !== "no_refund"} onChange={() => setOutcome(v)} className="size-4 accent-primary" />
            {l}
          </label>
        ))}
        {payOnDelivery && <p className="text-xs text-muted-foreground">Paid in cash to the seller, so TownMart can&apos;t refund it. Explain what the seller should do in the note.</p>}
      </fieldset>
      {outcome === "refund_partial" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="resolve-amount">Amount (₦)</Label>
          <Input id="resolve-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {fieldErrors.amount && <p className="text-sm text-danger">{fieldErrors.amount[0]}</p>}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="resolve-note">Explain the decision to both sides</Label>
        <Textarea id="resolve-note" rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        {fieldErrors.note && <p className="text-sm text-danger">{fieldErrors.note[0]}</p>}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending && <Loader2 className="animate-spin" aria-hidden />} Record decision
      </Button>
      {out}
    </form>
  );
}
