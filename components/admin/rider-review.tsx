"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reviewRiderAction } from "@/lib/admin/rider-actions";
import type { PoolRiderStatus } from "@/lib/riders/pool";

type Decision = "approve" | "reject" | "suspend" | "restore";
const BUTTONS: Record<PoolRiderStatus, { decision: Decision; label: string; needsNote?: boolean; variant: "default" | "outline" | "ghost" }[]> = {
  pending: [
    { decision: "approve", label: "Approve", variant: "default" },
    { decision: "reject", label: "Decline", needsNote: true, variant: "outline" },
  ],
  approved: [{ decision: "suspend", label: "Suspend", needsNote: true, variant: "outline" }],
  suspended: [{ decision: "restore", label: "Restore", variant: "default" }],
  rejected: [{ decision: "approve", label: "Approve after all", variant: "outline" }],
};

/** Approve, decline, suspend or restore a TownMart rider. Declining and suspending need a reason the rider sees. */
export function RiderReviewButtons({ id, status }: { id: string; status: PoolRiderStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const go = (decision: Decision) =>
    start(async () => {
      const r = await reviewRiderAction({ id, decision, note });
      setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Something went wrong." });
      if (r.ok) {
        setAsking(null);
        setNote("");
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-2 lg:w-72">
      {asking ? (
        <div className="flex flex-col gap-2">
          <Input aria-label="Reason (the rider sees this)" placeholder="Reason (the rider sees this)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={() => go(asking)}>
              Confirm
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setAsking(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {BUTTONS[status].map((b) => (
            <Button key={b.decision} type="button" size="sm" variant={b.variant} disabled={pending} onClick={() => (b.needsNote ? setAsking(b.decision) : go(b.decision))}>
              {b.label}
            </Button>
          ))}
        </div>
      )}
      {msg && <Alert variant={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}
    </div>
  );
}
