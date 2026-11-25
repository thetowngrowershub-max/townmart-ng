import type { DeliveryRate } from "@prisma/client";
import type { BandRow } from "@/components/seller/zone-rates-form";
import { formatPrice, koboToNairaString } from "@/lib/money";

const kg = (g: number) => `${g / 1000} kg`;
const bandLabel = (r: DeliveryRate) => (r.maxWeightG === null ? `${kg(r.minWeightG)} and over` : r.minWeightG === 0 ? `Up to ${kg(r.maxWeightG)}` : `${kg(r.minWeightG)} – ${kg(r.maxWeightG)}`);

/** A rate band as the editor's row. */
export const toBandRow = (r: DeliveryRate): BandRow => ({
  upToKg: r.maxWeightG === null ? "" : String(r.maxWeightG / 1000),
  fee: koboToNairaString(r.feeKobo),
  freeOver: r.freeOverKobo === null ? "" : koboToNairaString(r.freeOverKobo),
  etaMin: String(r.etaDaysMin),
  etaMax: String(r.etaDaysMax),
});

/** A zone's weight bands: fee, delivery time and any free-delivery threshold. */
export function RateBands({ rates }: { rates: DeliveryRate[] }) {
  if (rates.length === 0) return <p className="text-sm text-muted-foreground">No delivery to this zone yet.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {rates.map((r) => (
        <div key={r.id} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{bandLabel(r)}</dt>
          <dd className="text-right tabular-nums">
            {formatPrice(r.feeKobo)} · {r.etaDaysMin}–{r.etaDaysMax} days
            {r.freeOverKobo !== null && <span className="block text-xs text-muted-foreground">Free over {formatPrice(r.freeOverKobo)}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
