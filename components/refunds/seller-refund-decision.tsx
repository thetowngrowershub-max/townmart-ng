"use client";

import { Check, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/validation/form-result";

type Approve = (input: { refundId: string; amount?: string; restock?: string[]; note?: string }) => Promise<ActionResult>;
type Reject = (input: { refundId: string; response: string }) => Promise<ActionResult>;

/**
 * Approve (in full or part, choosing what goes back on sale) or decline a
 * refund request. Used by the seller and, on their behalf, by TownMart.
 */
export function RefundDecision({ refundId, maxNaira, items, approve, reject, who }: { refundId: string; maxNaira: string; items: { orderItemId: string; title: string; qty: string; product: boolean }[]; approve: Approve; reject: Reject; who: "seller" | "admin" }) {
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [amount, setAmount] = useState("");
  const [restock, setRestock] = useState<string[]>(items.filter((i) => i.product).map((i) => i.orderItemId));
  const [note, setNote] = useState("");
  const [response, setResponse] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const done = (res: ActionResult) => {
    setMsg({ ok: res.ok, text: res.ok ? (res.message ?? "Done.") : (res.error ?? "Couldn't save.") });
    setFieldErrors(res.ok ? {} : (res.fieldErrors ?? {}));
    if (res.ok) router.refresh();
  };
  const products = items.filter((i) => i.product);

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Your answer" className="flex gap-2">
        <Button role="tab" aria-selected={mode === "approve"} variant={mode === "approve" ? "default" : "outline"} size="sm" onClick={() => setMode("approve")}>
          <Check aria-hidden /> Approve
        </Button>
        <Button role="tab" aria-selected={mode === "reject"} variant={mode === "reject" ? "default" : "outline"} size="sm" onClick={() => setMode("reject")}>
          <X aria-hidden /> Decline
        </Button>
      </div>
      {mode === "approve" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => done(await approve({ refundId, amount, restock, note })));
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="refund-amount">Amount to refund (₦)</Label>
            <Input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`${maxNaira} (what they asked for)`} aria-describedby="refund-amount-hint" />
            <p id="refund-amount-hint" className="text-xs text-muted-foreground">
              Leave empty to refund what the customer asked for. You can refund less, for example if part of it was fine.
            </p>
            {fieldErrors.amount && <p className="text-sm text-danger">{fieldErrors.amount[0]}</p>}
          </div>
          {products.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Put back on sale</legend>
              {products.map((i) => (
                <Checkbox
                  key={i.orderItemId}
                  id={`restock-${i.orderItemId}`}
                  label={`${i.qty} × ${i.title}`}
                  checked={restock.includes(i.orderItemId)}
                  onChange={(e) => setRestock(e.target.checked ? [...restock, i.orderItemId] : restock.filter((x) => x !== i.orderItemId))}
                />
              ))}
              <p className="text-xs text-muted-foreground">Untick anything damaged or not coming back to you.</p>
            </fieldset>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="refund-note">Note to the customer (optional)</Label>
            <Input id="refund-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {who === "seller" ? "The money goes back to the customer's original payment method straight away. The amount comes off your balance, less the commission TownMart returns." : "The refund is sent straight away and comes off the seller's balance."}
          </p>
          <Button type="submit" disabled={pending} className="self-start">
            {pending && <Loader2 className="animate-spin" aria-hidden /> } Approve refund
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => done(await reject({ refundId, response })));
          }}
        >
          <Label htmlFor="refund-response">Why are you declining?</Label>
          <Textarea id="refund-response" rows={4} maxLength={1000} value={response} onChange={(e) => setResponse(e.target.value)} placeholder="The customer sees this, and can ask TownMart to decide." />
          {fieldErrors.response && <p className="text-sm text-danger">{fieldErrors.response[0]}</p>}
          <Button type="submit" variant="danger" disabled={pending} className="self-start">
            Decline
          </Button>
        </form>
      )}
      <div aria-live="polite">{msg && <Alert variant={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}</div>
    </div>
  );
}
