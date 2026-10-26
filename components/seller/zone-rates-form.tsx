"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resetZoneRatesAction, saveZoneRatesAction } from "@/lib/delivery/actions";

export type BandRow = { upToKg: string; fee: string; freeOver: string; etaMin: string; etaMax: string };

const empty: BandRow = { upToKg: "", fee: "", freeOver: "", etaMin: "1", etaMax: "3" };

/**
 * Edits a seller's weight bands for one zone, starting from their own bands
 * or a copy of TownMart's defaults. Saving replaces all of the zone's bands.
 */
export function ZoneRatesForm({ zoneId, zoneName, initial, custom }: { zoneId: string; zoneName: string; initial: BandRow[]; custom: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [bands, setBands] = useState<BandRow[]>(initial.length ? initial : [empty]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const set = (i: number, k: keyof BandRow, v: string) => setBands((bs) => bs.map((b, j) => (j === i ? { ...b, [k]: v } : b)));
  const err = (i: number, k: keyof BandRow) => errors[`bands.${i}.${k}`];

  if (!editing)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          {custom ? "Edit your rates" : "Set your own rates"}
        </Button>
        {custom && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await resetZoneRatesAction({ zoneId });
                setMsg({ ok: res.ok, text: res.ok ? (res.message ?? "") : res.error });
                router.refresh();
              })
            }
          >
            Use TownMart&apos;s rates
          </Button>
        )}
        {msg && <p className={msg.ok ? "text-sm text-success-foreground" : "text-sm text-danger"}>{msg.text}</p>}
      </div>
    );

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveZoneRatesAction({ zoneId, bands });
          if (res.ok) {
            setEditing(false);
            setErrors({});
            setMsg({ ok: true, text: res.message ?? "Saved." });
            router.refresh();
          } else {
            setErrors(Object.fromEntries(Object.entries(res.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
            setMsg({ ok: false, text: res.fieldErrors?.bands?.[0] ?? res.error });
          }
        });
      }}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Delivery bands for {zoneName}</caption>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-1 font-medium">Up to (kg)</th>
              <th className="pb-1 font-medium">Fee (₦)</th>
              <th className="pb-1 font-medium">Free over (₦)</th>
              <th className="pb-1 font-medium">Arrives in (days)</th>
              <th className="pb-1">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i} className="align-top">
                <td className="py-1 pr-2">
                  <Input aria-label={`Band ${i + 1}: up to kg`} inputMode="decimal" value={b.upToKg} onChange={(e) => set(i, "upToKg", e.target.value)} placeholder={i === bands.length - 1 ? "No limit" : ""} aria-invalid={Boolean(err(i, "upToKg"))} />
                  {err(i, "upToKg") && <p className="mt-1 text-xs text-danger">{err(i, "upToKg")}</p>}
                </td>
                <td className="py-1 pr-2">
                  <Input aria-label={`Band ${i + 1}: fee in naira`} inputMode="decimal" value={b.fee} onChange={(e) => set(i, "fee", e.target.value)} aria-invalid={Boolean(err(i, "fee"))} />
                  {err(i, "fee") && <p className="mt-1 text-xs text-danger">{err(i, "fee")}</p>}
                </td>
                <td className="py-1 pr-2">
                  <Input aria-label={`Band ${i + 1}: free delivery over, in naira`} inputMode="decimal" value={b.freeOver} onChange={(e) => set(i, "freeOver", e.target.value)} placeholder="Never free" aria-invalid={Boolean(err(i, "freeOver"))} />
                  {err(i, "freeOver") && <p className="mt-1 text-xs text-danger">{err(i, "freeOver")}</p>}
                </td>
                <td className="py-1 pr-2">
                  <div className="flex items-center gap-1">
                    <Input aria-label={`Band ${i + 1}: earliest day`} className="w-16" inputMode="numeric" value={b.etaMin} onChange={(e) => set(i, "etaMin", e.target.value)} />
                    <span aria-hidden>–</span>
                    <Input aria-label={`Band ${i + 1}: latest day`} className="w-16" inputMode="numeric" value={b.etaMax} onChange={(e) => set(i, "etaMax", e.target.value)} aria-invalid={Boolean(err(i, "etaMax"))} />
                  </div>
                  {(err(i, "etaMin") || err(i, "etaMax")) && <p className="mt-1 text-xs text-danger">{err(i, "etaMin") ?? err(i, "etaMax")}</p>}
                </td>
                <td className="py-1">
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove band ${i + 1}`} disabled={bands.length === 1} onClick={() => setBands((bs) => bs.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bands.length < 8 && (
        <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setBands((bs) => [...bs, empty])}>
          <Plus aria-hidden /> Add a heavier band
        </Button>
      )}
      <p className="text-xs text-muted-foreground">Each band starts where the one above stops. Leave the last band&apos;s weight empty to cover anything heavier.</p>
      {msg && !msg.ok && <Alert variant="danger">{msg.text}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save rates"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
