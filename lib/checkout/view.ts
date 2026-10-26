import { unitLabel } from "@/lib/catalogue/units";
import { formatPrice } from "@/lib/money";
import { publicImageUrl } from "@/lib/storage";
import type { UnitOfMeasure } from "@prisma/client";
import type { CheckoutComputation, ComputedLine, LineProblem } from "./compute";

/** What the cart and checkout pages show. Plain strings, so it can cross to client components. */
export type LineView = {
  id: string;
  title: string;
  href: string;
  options: string;
  imageUrl: string | null;
  imageAlt: string;
  qty: string;
  step: string;
  minQty: string;
  unit: string;
  perUnit: string;
  unitPrice: string;
  subtotal: string;
  discount: string | null;
  total: string;
  promotions: string[];
  problem: string | null;
};

export type SellerView = {
  businessId: string;
  name: string;
  href: string;
  location: string;
  lines: LineView[];
  goods: string;
  offersDelivery: boolean;
  offersPickup: boolean;
  deliveryNotes: string;
  method: "delivery" | "pickup" | null;
  delivery: { fee: string; free: boolean; eta: string; zone: string; freeOver: string | null } | null;
  returnWindowDays: number;
};

export type CheckoutView = {
  sellers: SellerView[];
  saved: LineView[];
  coupon: { code: string | null; state: "none" | "applied" | "invalid" | "not_applicable"; message: string | null; saving: string | null };
  totals: { subtotal: string; discount: string | null; delivery: string | null; serviceFee: string; vat: string; total: string; totalKobo: string };
  payOnDeliveryAvailable: boolean;
  holdMinutes: number;
  blockers: string[];
  itemCount: number;
};

function problemText(p: LineProblem | null, unit: string): string | null {
  if (!p) return null;
  switch (p.kind) {
    case "unavailable":
      return "No longer available. Remove it to continue.";
    case "out_of_stock":
      return "Out of stock. Remove it or save it for later.";
    case "not_enough":
      return `Only ${p.available} ${unit} left. Lower the quantity to continue.`;
    case "below_minimum":
      return `The minimum order is ${p.minimum} ${unit}.`;
    case "fraction_not_allowed":
      return "This item is sold in whole units.";
  }
}

export function toCheckoutView(c: CheckoutComputation): CheckoutView {
  const priced = new Map(c.priced.lines.map((l) => [l.key, l]));
  const line = (l: ComputedLine): LineView => {
    const p = priced.get(l.cartItemId);
    const unit = unitLabel(l.unit as UnitOfMeasure, l.qty.toNumber());
    return {
      id: l.cartItemId,
      title: l.title,
      href: `/p/${l.slug}`,
      options: Object.values(l.optionValues).join(", "),
      imageUrl: l.imageKey ? publicImageUrl(l.imageKey) : null,
      imageAlt: l.imageAlt ?? l.title,
      qty: l.qty.toString(),
      step: l.allowFractionalQty ? "0.5" : "1",
      minQty: l.minOrderQty.toString(),
      unit,
      perUnit: unitLabel(l.unit as UnitOfMeasure, 1),
      unitPrice: formatPrice(l.unitPriceKobo),
      subtotal: formatPrice(p?.subtotalKobo ?? 0n),
      discount: p && p.discountKobo > 0n ? formatPrice(p.discountKobo) : null,
      total: formatPrice(p?.totalKobo ?? 0n),
      promotions: p?.promotions.map((x) => x.name) ?? [],
      problem: problemText(l.problem, unit),
    };
  };
  const quoteBy = new Map(c.quote.sellers.map((s) => [s.businessId, s]));
  const sellers: SellerView[] = [];
  // Sellers in the order their first item was added; unavailable-only sellers still show.
  const order = [...new Set(c.lines.map((l) => l.businessId))];
  for (const businessId of order) {
    const s = c.sellers.find((x) => x.businessId === businessId);
    const lines = c.lines.filter((l) => l.businessId === businessId).map(line);
    const q = quoteBy.get(businessId);
    sellers.push({
      businessId,
      name: s?.name ?? "Unavailable seller",
      href: s ? `/store/${s.slug}` : "#",
      location: s ? `${s.city}, ${s.stateName}` : "",
      lines,
      goods: formatPrice(q ? q.subtotalKobo - q.discountKobo : 0n),
      offersDelivery: s?.offersDelivery ?? false,
      offersPickup: s?.offersPickup ?? false,
      deliveryNotes: s?.deliveryNotes ?? "",
      method: s?.method ?? null,
      delivery: s?.delivery
        ? {
            fee: s.delivery.free ? "Free" : formatPrice(s.delivery.feeKobo),
            free: s.delivery.free,
            eta: s.delivery.etaDaysMin === s.delivery.etaDaysMax ? `${s.delivery.etaDaysMin} working day${s.delivery.etaDaysMin === 1 ? "" : "s"}` : `${s.delivery.etaDaysMin}–${s.delivery.etaDaysMax} working days`,
            zone: s.delivery.zoneName,
            freeOver: s.delivery.freeOverKobo !== null && !s.delivery.free ? formatPrice(s.delivery.freeOverKobo) : null,
          }
        : null,
      returnWindowDays: s?.returnWindowDays ?? 7,
    });
  }
  const coupon = c.priced.coupon;
  const hasAddress = c.hasAddress;
  return {
    sellers,
    saved: c.saved.map(line),
    coupon: {
      code: c.couponCode,
      state: coupon.state,
      message: coupon.state === "invalid" || coupon.state === "not_applicable" ? coupon.message : null,
      saving: coupon.state === "applied" ? formatPrice(coupon.discountKobo) : null,
    },
    totals: {
      subtotal: formatPrice(c.quote.subtotalKobo),
      discount: c.quote.discountKobo > 0n ? formatPrice(c.quote.discountKobo) : null,
      delivery: hasAddress ? (c.quote.deliveryKobo === 0n ? "Free" : formatPrice(c.quote.deliveryKobo)) : null,
      serviceFee: formatPrice(c.quote.serviceFeeKobo),
      vat: formatPrice(c.quote.vatKobo),
      total: formatPrice(c.quote.totalKobo),
      totalKobo: c.quote.totalKobo.toString(),
    },
    payOnDeliveryAvailable: c.payOnDeliveryAvailable,
    holdMinutes: c.settings.stockHoldMinutes,
    blockers: c.blockers,
    itemCount: c.lines.length,
  };
}
