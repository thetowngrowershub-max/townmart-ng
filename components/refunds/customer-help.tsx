"use client";

import { Camera, Loader2, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { uploadEvidence } from "@/components/uploads/upload-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cancelOrderAction, customerDisputeMessageAction, openDisputeAction, requestRefundAction, withdrawDisputeAction } from "@/lib/refunds/actions";
import type { DisputeView, HelpView } from "@/lib/refunds/view";
import { DisputeThread } from "./dispute-thread";

type Order = { orderNumber: string; token: string | null; sellerOrderId: string };

/** Cancels a paid order the seller hasn't started, with a full refund. */
export function CancelPaidOrder({ order }: { order: Order }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <X aria-hidden /> Cancel this part of the order
      </Button>
    );
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4">
      <Label htmlFor="cancel-reason">Why are you cancelling? (optional)</Label>
      <Input id="cancel-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="text-sm text-muted-foreground">You&apos;ll get everything you paid for it back to your original payment method.</p>
      <div className="flex gap-2">
        <Button
          variant="danger"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await cancelOrderAction({ ...order, reason });
              setMsg({ ok: res.ok, text: res.ok ? res.message! : res.error! });
              if (res.ok) router.refresh();
            })
          }
        >
          {pending && <Loader2 className="animate-spin" aria-hidden />} Cancel and refund
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
      <div aria-live="polite">{msg && <Alert variant={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}</div>
    </div>
  );
}

/** Asks the seller to refund or take back some items, with photos. */
export function RefundRequestForm({ order, items, reasons }: { order: Order; items: HelpView["items"]; reasons: { value: string; label: string; photo: boolean }[] }) {
  const router = useRouter();
  const choosable = items.filter((i) => i.refundable > 0 && i.windowOpen);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [photos, setPhotos] = useState<{ key: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const needsPhoto = reasons.find((r) => r.value === reason)?.photo || choosable.some((i) => i.perishable && (qty[i.id] ?? 0) > 0);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const f of Array.from(files).slice(0, 4 - photos.length)) {
        const key = await uploadEvidence(f, { orderNumber: order.orderNumber, token: order.token });
        setPhotos((p) => [...p, { key, name: f.name }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const chosen = Object.entries(qty).filter(([, q]) => q > 0).map(([orderItemId, q]) => ({ orderItemId, qty: q }));
        start(async () => {
          const res = await requestRefundAction({ ...order, reason, details, items: chosen, evidenceKeys: photos.map((p) => p.key) });
          if (res.ok) {
            router.push(res.data!.href);
            router.refresh();
          } else {
            setErrors(res.fieldErrors ?? {});
            setError(res.error ?? null);
          }
        });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Which items?</legend>
        {choosable.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <div>
              <p className="font-medium">{i.title}</p>
              <p className="text-muted-foreground">
                {i.options && `${i.options} · `}
                {i.unitPaid} each{i.perishable && " · fresh: photo needed, report within 24 hours"}
              </p>
            </div>
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Qty</span>
              <Select aria-label={`How many ${i.title}`} value={String(qty[i.id] ?? 0)} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })} className="w-20">
                {Array.from({ length: Math.floor(i.refundable) + 1 }, (_, n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        ))}
        {errors.items && <p className="text-sm text-danger">{errors.items[0]}</p>}
      </fieldset>
      <div className="flex flex-col gap-1">
        <Label htmlFor="refund-reason">What went wrong?</Label>
        <Select id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} required>
          <option value="">Choose a reason</option>
          {reasons.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        {errors.reason && <p className="text-sm text-danger">{errors.reason[0]}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="refund-details">Tell the seller more</Label>
        <Textarea id="refund-details" rows={4} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What happened, and what you'd like: a refund, or a return" />
        {errors.details && <p className="text-sm text-danger">{errors.details[0]}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Photos {needsPhoto ? "(needed)" : "(optional)"}</p>
        <ul className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <li key={p.key} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-sm">
              {p.name}
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPhotos(photos.filter((x) => x.key !== p.key))} className="rounded p-0.5 hover:bg-muted">
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        {photos.length < 4 && (
          <div>
            <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" id="refund-photos" onChange={(e) => addPhotos(e.target.files)} />
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <Camera aria-hidden />} Add photos
            </Button>
          </div>
        )}
        {errors.evidenceKeys && <p className="text-sm text-danger">{errors.evidenceKeys[0]}</p>}
      </div>
      <div aria-live="polite">{error && <Alert variant="danger">{error}</Alert>}</div>
      <Button type="submit" disabled={pending || uploading} className="self-start">
        {pending && <Loader2 className="animate-spin" aria-hidden />} Send to the seller
      </Button>
    </form>
  );
}

/** Asks TownMart to step in. */
export function OpenDisputeForm({ order, refundId }: { order: Order; refundId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Ask TownMart to decide
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await openDisputeAction({ ...order, refundId: refundId ?? undefined, reason });
          if (res.ok) router.refresh();
          else setError(res.fieldErrors?.reason?.[0] ?? res.error ?? null);
        });
      }}
    >
      <Label htmlFor="dispute-reason">{refundId ? "Why should TownMart look at the seller's answer again?" : "What's wrong, and what would put it right?"}</Label>
      <Textarea id="dispute-reason" rows={4} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} required />
      <p className="text-sm text-muted-foreground">Our team reads both sides and decides, usually within two working days. The seller can see what you write.</p>
      <div aria-live="polite">{error && <Alert variant="danger">{error}</Alert>}</div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || reason.trim().length < 10}>
          Send to TownMart
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Not now
        </Button>
      </div>
    </form>
  );
}

export function CustomerDispute({ order, dispute }: { order: Order; dispute: DisputeView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <DisputeThread
      dispute={dispute}
      me="customer"
      send={(body) => customerDisputeMessageAction({ orderNumber: order.orderNumber, token: order.token, disputeId: dispute.id, body })}
      extra={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (!confirm("Withdraw this dispute? TownMart will stop looking at it.")) return;
            start(async () => {
              const res = await withdrawDisputeAction({ orderNumber: order.orderNumber, token: order.token, disputeId: dispute.id });
              if (res.ok) router.refresh();
              else alert(res.error);
            });
          }}
        >
          <Undo2 aria-hidden /> Withdraw
        </Button>
      }
    />
  );
}
