import { formatPrice } from "@/lib/money";

/** "₦5,000/hr", "From ₦5,000" or "₦5,000", by the service's pricing model. */
export function servicePriceLabel(model: string, kobo: bigint) {
  if (model === "hourly") return `${formatPrice(kobo)}/hr`;
  if (model === "from" || model === "packages") return `From ${formatPrice(kobo)}`;
  return formatPrice(kobo);
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24 && m === 0 && h % 24 === 0) return `${h / 24} day${h === 24 ? "" : "s"}`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
