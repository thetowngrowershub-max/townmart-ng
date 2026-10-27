"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { saveNotificationPreferencesAction } from "@/lib/account/actions";
import type { ActionResult } from "@/lib/validation/form-result";

export type Preferences = { smsOrderUpdates: boolean; smsBookingReminders: boolean; emailMessages: boolean; marketingEmail: boolean; marketingSms: boolean };

const ROWS: { key: keyof Preferences; label: string; hint: string }[] = [
  { key: "smsOrderUpdates", label: "Order updates by text", hint: "When your items are sent, ready to collect or cancelled." },
  { key: "smsBookingReminders", label: "Booking reminders by text", hint: "The day before and an hour before a booking." },
  { key: "emailMessages", label: "Seller messages by email", hint: "An email when a seller writes to you. They always show here too." },
  { key: "marketingEmail", label: "Offers and news by email", hint: "Optional. Every offer email has a one-click unsubscribe link." },
  { key: "marketingSms", label: "Offers by text", hint: "Optional. Reply STOP or switch it off here." },
];

export function NotificationPreferences({ initial }: { initial: Preferences }) {
  const [prefs, setPrefs] = useState(initial);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveNotificationPreferencesAction(prefs)));
      }}
    >
      <p className="text-sm text-muted-foreground">Receipts, refunds and security emails always come, so you never miss something about your money or account.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {ROWS.map((r) => (
          <Checkbox key={r.key} id={`pref-${r.key}`} label={r.label} hint={r.hint} checked={prefs[r.key]} onChange={(e) => setPrefs((p) => ({ ...p, [r.key]: e.target.checked }))} />
        ))}
      </div>
      {result && <Alert variant={result.ok ? "success" : "danger"}>{result.ok ? result.message : result.error}</Alert>}
      <Button type="submit" variant="outline" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
