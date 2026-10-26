"use client";

import { CalendarClock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  bookingStepAction,
  customerCancelBookingAction,
  customerRescheduleAction,
  sellerCancelBookingAction,
  sellerRescheduleAction,
} from "@/lib/bookings/actions";
import type { SellerBookingStep } from "@/lib/bookings/manage";
import { SlotPicker } from "./slot-picker";

const STEP_LABELS: Record<SellerBookingStep, string> = { confirm: "Confirm", start: "Start", complete: "Mark as done", no_show: "Didn't show up" };

type Result = { ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string[]> };

/**
 * What can be done with one booking. Sellers step it along, decline or
 * cancel with a reason, or move it; customers cancel or move it before it
 * starts.
 */
export function BookingActions(
  props: { booking: { id: string; serviceId: string; packageId: string | null; canChange: boolean } } & (
    | { side: "seller"; steps: SellerBookingStep[]; isRequest: boolean }
    | { side: "customer"; orderNumber: string; token?: string | null }
  ),
) {
  const { booking } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "cancel" | "move">("idle");
  const [reason, setReason] = useState("");
  const [time, setTime] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setMsg(res.message ? { ok: true, text: res.message } : null);
        setMode("idle");
        router.refresh();
      } else {
        setMsg({ ok: false, text: Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.error ?? "Something went wrong." });
        if (mode === "move") setReload((n) => n + 1);
      }
    });

  const cancel = () =>
    run(() =>
      props.side === "seller"
        ? sellerCancelBookingAction({ bookingId: booking.id, reason })
        : customerCancelBookingAction({ orderNumber: props.orderNumber, token: props.token, bookingId: booking.id, reason }),
    );
  const move = () =>
    time &&
    run(() =>
      props.side === "seller"
        ? sellerRescheduleAction({ bookingId: booking.id, startsAt: time })
        : customerRescheduleAction({ orderNumber: props.orderNumber, token: props.token, bookingId: booking.id, startsAt: time }),
    );

  const steps = props.side === "seller" ? props.steps : [];
  if (!steps.length && !booking.canChange) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {steps.map((s) => (
          <Button key={s} type="button" size="sm" variant={s === "no_show" ? "outline" : "default"} disabled={pending} onClick={() => run(() => bookingStepAction({ bookingId: booking.id, step: s }))}>
            {STEP_LABELS[s]}
          </Button>
        ))}
        {booking.canChange && mode === "idle" && (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => setMode("move")}>
              <CalendarClock aria-hidden /> Change time
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-danger" onClick={() => setMode("cancel")}>
              <X aria-hidden /> {props.side === "seller" && props.isRequest ? "Decline" : "Cancel booking"}
            </Button>
          </>
        )}
      </div>
      {mode === "cancel" && (
        <form
          className="flex flex-col gap-2 rounded-xl border border-danger/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            cancel();
          }}
        >
          <Label htmlFor={`reason-${booking.id}`}>{props.side === "seller" ? "Reason (the customer sees this)" : "Reason (optional)"}</Label>
          <Input id={`reason-${booking.id}`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            {props.side === "seller"
              ? "If the customer paid, they get a full refund."
              : "Cancelling 24 hours or more before the start gets a full refund of what you paid. Later cancellations may get a partial refund or none."}
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="danger" disabled={pending}>
              {props.side === "seller" && props.isRequest ? "Decline booking" : "Cancel booking"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
              Keep it
            </Button>
          </div>
        </form>
      )}
      {mode === "move" && (
        <div className="flex flex-col gap-3 rounded-xl border p-3">
          <SlotPicker serviceId={booking.serviceId} packageId={booking.packageId} value={time} onChange={setTime} reload={reload} />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={!time || pending} onClick={move}>
              Move to this time
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
              Never mind
            </Button>
          </div>
        </div>
      )}
      <div aria-live="polite">{msg && (msg.ok ? <p className="text-sm text-success">{msg.text}</p> : <Alert variant="danger">{msg.text}</Alert>)}</div>
    </div>
  );
}
