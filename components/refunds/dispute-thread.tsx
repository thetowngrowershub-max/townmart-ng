"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DisputeView } from "@/lib/refunds/view";
import { cn } from "@/lib/utils";

type Result = { ok: boolean; error?: string; fieldErrors?: Record<string, string[]> };

/**
 * A dispute's thread, visible to the customer, the seller and TownMart, with
 * a reply box while it's open. `send` is the side's own server action.
 */
export function DisputeThread({ dispute, me, send, extra }: { dispute: DisputeView; me: "customer" | "seller" | "admin"; send?: (body: string) => Promise<Result>; extra?: React.ReactNode }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mine = (p: string) => p === me || (me === "admin" && p === "system");
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-3" aria-label="Messages">
        {dispute.messages.map((m) => (
          <li key={m.id} className={cn("max-w-[85%] rounded-2xl px-4 py-2 text-sm", mine(m.party) ? "self-end bg-primary-soft" : m.party === "admin" || m.party === "system" ? "border border-primary/30 bg-card" : "bg-muted")}>
            <p className="text-xs font-semibold text-muted-foreground">
              {m.from} · {m.at}
            </p>
            <p className="mt-1 whitespace-pre-line">{m.body}</p>
          </li>
        ))}
      </ol>
      {dispute.status === "open" && send ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await send(body);
              if (res.ok) {
                setBody("");
                setError(null);
                router.refresh();
              } else setError(res.fieldErrors?.body?.[0] ?? res.error ?? "Couldn't send.");
            });
          }}
        >
          <Label htmlFor="dispute-reply">Add to the dispute</Label>
          <Textarea id="dispute-reply" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={me === "admin" ? "Ask either side a question, or explain what happens next" : "Anything TownMart should know"} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending || !body.trim()}>
              <Send aria-hidden /> Send
            </Button>
            {extra}
          </div>
          <div aria-live="polite">{error && <Alert variant="danger">{error}</Alert>}</div>
        </form>
      ) : dispute.status !== "open" ? (
        <p className="rounded-xl bg-muted p-3 text-sm">
          {dispute.status === "resolved" ? `Decided by TownMart ${dispute.resolvedAt}: ${dispute.outcome}. This decision is final.` : "Withdrawn by the customer."}
        </p>
      ) : null}
    </div>
  );
}
