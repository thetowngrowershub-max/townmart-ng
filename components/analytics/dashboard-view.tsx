import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { BarChart } from "@/components/analytics/bar-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dashboard } from "@/lib/analytics/metrics";
import { formatNaira } from "@/lib/money";
import { cn } from "@/lib/utils";

const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;

function Change({ value, unit = "%", lowerIsBetter = false }: { value: number | null; unit?: string; lowerIsBetter?: boolean }) {
  if (value === null) return <span className="text-xs text-muted-foreground">No earlier figure</span>;
  const good = lowerIsBetter ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", value === 0 ? "text-muted-foreground" : good ? "text-success" : "text-danger")}>
      <Icon className="size-3.5" aria-hidden />
      {value > 0 ? "+" : ""}
      {value}
      {unit} <span className="font-normal text-muted-foreground">vs previous period</span>
    </span>
  );
}

function Tile({ label, value, change, hint }: { label: string; value: string; change: React.ReactNode; hint?: string }) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-heading text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
      {change}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/** A ranked list with a thin bar showing each row's share of the leader. */
function Ranking({ title, description, rows, empty }: { title: string; description: string; rows: { key: string; name: string; value: number; display: string; detail: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="shrink-0 tabular-nums">{r.display}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted" aria-hidden>
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">{r.detail}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardTiles({ d }: { d: Dashboard }) {
  const t = d.totals;
  return (
    <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <li><Tile label="GMV" value={formatNaira(t.gmvKobo)} change={<Change value={d.changes.gmv} />} /></li>
      <li><Tile label="Orders" value={t.orders.toLocaleString("en-NG")} change={<Change value={d.changes.orders} />} /></li>
      <li><Tile label="Average order" value={formatNaira(t.aovKobo)} change={<Change value={d.changes.aov} />} /></li>
      <li><Tile label="Refund rate" value={percent(t.refundRateBps)} change={<Change value={d.changes.refundRate === null ? null : Math.round(d.changes.refundRate) / 100} unit=" pts" lowerIsBetter />} hint={`${formatNaira(t.refundsKobo)} refunded on ${t.refundedOrders} order${t.refundedOrders === 1 ? "" : "s"}`} /></li>
      <li><Tile label="Active sellers" value={t.activeSellers.toLocaleString("en-NG")} change={<Change value={d.changes.activeSellers} />} hint={`of ${t.approvedSellers} approved`} /></li>
      <li><Tile label="New customers" value={t.newCustomers.toLocaleString("en-NG")} change={<Change value={d.changes.newCustomers} />} /></li>
      <li><Tile label="Bookings" value={t.bookings.toLocaleString("en-NG")} change={<Change value={d.changes.bookings} />} /></li>
    </ul>
  );
}

export function GmvChart({ d }: { d: Dashboard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>GMV by day</CardTitle>
        <CardDescription>Confirmed orders by the day they were placed, Lagos time.</CardDescription>
      </CardHeader>
      <CardContent>
        <BarChart
          title="GMV by day"
          valueLabel="GMV"
          points={d.series.map((p) => ({
            key: p.day,
            label: dayLabel(p.day),
            value: Number(p.gmvKobo),
            display: formatNaira(p.gmvKobo),
            detail: `${p.orders} order${p.orders === 1 ? "" : "s"}`,
          }))}
        />
      </CardContent>
    </Card>
  );
}

export function DashboardRankings({ d }: { d: Dashboard }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Ranking
        title="Top categories"
        description="Items sold, after discounts"
        empty="No sales in this period."
        rows={d.categories.map((c) => ({ key: c.id, name: c.name, value: Number(c.gmvKobo), display: formatNaira(c.gmvKobo), detail: `${c.orders} order${c.orders === 1 ? "" : "s"}` }))}
      />
      <Ranking
        title="Top sellers"
        description="Items and delivery, after discounts"
        empty="No sales in this period."
        rows={d.sellers.map((s) => ({ key: s.id, name: s.name, value: Number(s.gmvKobo), display: formatNaira(s.gmvKobo), detail: `${s.orders} order${s.orders === 1 ? "" : "s"}` }))}
      />
      <Ranking
        title="Where orders go"
        description="Confirmed orders by delivery state"
        empty="No orders in this period."
        rows={d.states.map((s) => ({ key: s.name, name: s.name, value: s.orders, display: s.orders.toLocaleString("en-NG"), detail: "" }))}
      />
    </div>
  );
}

export function MetricDefinitions() {
  return (
    <details className="text-sm text-muted-foreground">
      <summary className="cursor-pointer">How these figures are counted</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Confirmed orders were paid online or accepted as pay on delivery. Unpaid, failed and expired checkouts don&apos;t count.</li>
        <li>GMV is what customers agreed to pay on confirmed orders (items, delivery, fees and VAT, after discounts), before refunds.</li>
        <li>Refund rate is refunds paid in the period as a share of GMV in the period.</li>
        <li>Active sellers had at least one confirmed order. New customers signed up in the period and aren&apos;t sellers or staff.</li>
        <li>Each period runs from midnight Lagos time and is compared with the same number of days before it.</li>
      </ul>
    </details>
  );
}
