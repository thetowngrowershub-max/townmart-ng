import type { CheckoutView } from "@/lib/checkout/view";

/** Itemised totals. Shown on the cart (before delivery is known) and at checkout. */
export function OrderSummary({ totals, totalLabel = "Total" }: { totals: CheckoutView["totals"]; totalLabel?: string }) {
  const row = (label: string, value: string, className?: string) => (
    <div className={`flex justify-between gap-4 ${className ?? ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {row("Items", totals.subtotal)}
      {totals.discount && row("Discounts", `−${totals.discount}`, "text-success")}
      {row("Delivery", totals.delivery ?? "Calculated at checkout", totals.delivery ? undefined : "text-muted-foreground")}
      {row("Service fee", totals.serviceFee)}
      {row("VAT (7.5% of service fee)", totals.vat)}
      <div className="mt-2 flex justify-between gap-4 border-t pt-3 text-base font-bold">
        <dt>{totalLabel}</dt>
        <dd className="tabular-nums">{totals.total}</dd>
      </div>
    </dl>
  );
}
