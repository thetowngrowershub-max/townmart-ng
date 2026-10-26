import { formatPrice } from "@/lib/money";

const dayLabel = new Intl.DateTimeFormat("en-NG", { timeZone: "UTC", day: "numeric", month: "short" });
const weekday = new Intl.DateTimeFormat("en-NG", { timeZone: "UTC", weekday: "short" });

/**
 * Daily earnings as columns, one series (so no legend: the card title names
 * it). Each column shows its value on hover or focus; the same figures are in
 * a table for screen readers.
 */
export function SalesChart({ days }: { days: { date: string; kobo: bigint; orders: number }[] }) {
  const max = days.reduce((m, d) => (d.kobo > m ? d.kobo : m), 0n);
  const label = (date: string) => dayLabel.format(new Date(`${date}T00:00:00Z`));
  const peak = days.find((d) => d.kobo === max && max > 0n);
  return (
    <figure className="flex flex-col gap-2">
      <div className="relative h-40 border-b border-border" aria-hidden>
        {[0.5, 1].map((f) => (
          <div key={f} className="absolute inset-x-0 border-t border-dashed border-border/60" style={{ bottom: `${f * 100}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end gap-0.5">
          {days.map((d) => {
            const h = max > 0n ? Number((d.kobo * 1000n) / max) / 10 : 0;
            return (
              <div key={d.date} tabIndex={0} className="group relative flex h-full flex-1 items-end justify-center outline-none">
                <div className="w-full max-w-7 rounded-t-[4px] bg-primary transition-opacity group-hover:opacity-80 group-focus:opacity-80" style={{ height: d.kobo > 0n ? `max(${h}%, 2px)` : "0" }} />
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-lg border bg-popover px-2 py-1 text-xs text-popover-foreground shadow group-hover:block group-focus:block">
                  <p className="font-medium">
                    {weekday.format(new Date(`${d.date}T00:00:00Z`))} {label(d.date)}
                  </p>
                  <p className="tabular-nums">
                    {formatPrice(d.kobo)} · {d.orders} order{d.orders === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        {peak && <span className="absolute top-0 left-0 -translate-y-full pb-0.5 text-[11px] text-muted-foreground">{formatPrice(max)}</span>}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden>
        <span>{label(days[0]!.date)}</span>
        <span>Today</span>
      </div>
      <table className="sr-only">
        <caption>Your earnings per day, last 14 days</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Earnings</th>
            <th>Orders</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{label(d.date)}</td>
              <td>{formatPrice(d.kobo)}</td>
              <td>{d.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
