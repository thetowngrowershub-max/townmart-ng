"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendSellerMessageAction } from "@/lib/fulfilment/actions";
import { sendCustomerMessageAction } from "@/lib/fulfilment/customer-actions";
import type { MessageView } from "@/lib/fulfilment/messages";
import { cn } from "@/lib/utils";

/** The conversation between a customer and one seller about an order. */
export function OrderMessages({
  messages,
  sellerOrderId,
  side,
  orderNumber,
  token,
  otherName,
}: {
  messages: MessageView[];
  sellerOrderId: string;
  side: "seller" | "customer";
  orderNumber?: string;
  token?: string | null;
  otherName: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      const res =
        side === "seller"
          ? await sendSellerMessageAction({ sellerOrderId, body })
          : await sendCustomerMessageAction({ orderNumber: orderNumber!, token, sellerOrderId, body });
      if (res.ok) {
        setBody("");
        setError(null);
        router.refresh();
      } else setError(res.fieldErrors?.body?.[0] ?? res.error);
    });

  return (
    <div className="flex flex-col gap-3">
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages yet. Questions about delivery or timing? Write to {otherName} here.</p>
      ) : (
        <ol className="flex max-h-96 flex-col gap-2 overflow-y-auto" aria-label="Messages">
          {messages.map((m) => (
            <li key={m.id} className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", m.mine ? "self-end bg-primary-soft" : "self-start bg-muted")}>
              <p className="text-xs font-medium text-muted-foreground">
                {m.mine ? "You" : m.author} · {m.at}
              </p>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) send();
        }}
      >
        <label htmlFor={`msg-${sellerOrderId}`} className="sr-only">
          Message to {otherName}
        </label>
        <Textarea id={`msg-${sellerOrderId}`} rows={2} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Write to ${otherName}…`} />
        {error && <Alert variant="danger">{error}</Alert>}
        <Button type="submit" size="sm" className="self-end" disabled={pending || !body.trim()}>
          <Send aria-hidden /> {pending ? "Sending…" : "Send"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Keep payments on TownMart. Never share card details or one-time codes in messages.</p>
    </div>
  );
}
