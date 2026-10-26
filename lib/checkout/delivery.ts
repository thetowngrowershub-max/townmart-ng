/**
 * Delivery fees. Pure: the caller loads zones and rates. Zones are where the
 * parcel goes (the shopper's state and LGA); a seller's own rate for a zone
 * replaces TownMart's default for it.
 */

export type Zone = { id: string; name: string; stateIds: readonly number[]; lgaIds: readonly number[]; priority: number };

export type Rate = {
  zoneId: string;
  businessId: string | null;
  minWeightG: number;
  maxWeightG: number | null;
  feeKobo: bigint;
  freeOverKobo: bigint | null;
  etaDaysMin: number;
  etaDaysMax: number;
};

export type DeliveryQuote = {
  zoneName: string;
  feeKobo: bigint;
  /** True when the order qualified for free delivery. */
  free: boolean;
  /** How much more the shopper would need to spend for free delivery, if that's possible. */
  freeOverKobo: bigint | null;
  etaDaysMin: number;
  etaDaysMax: number;
};

/** Items with no weight set count as this much each. */
export const DEFAULT_ITEM_WEIGHT_G = 500;

/** The best zone for an address: one naming the LGA wins over one naming the state; then the lowest priority number. */
export function zoneFor(zones: readonly Zone[], stateId: number, lgaId: number): Zone | null {
  const byLga = zones.filter((z) => z.lgaIds.includes(lgaId));
  const candidates = byLga.length ? byLga : zones.filter((z) => z.stateIds.includes(stateId));
  return [...candidates].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))[0] ?? null;
}

const inBand = (r: Rate, weightG: number) => weightG >= r.minWeightG && (r.maxWeightG === null || weightG < r.maxWeightG);

/**
 * Quotes delivery for one seller's parcel. `goodsKobo` is the seller's items
 * after discounts (what free-delivery thresholds are measured against).
 * Returns null when nobody delivers there at that weight.
 */
export function quoteDelivery(params: {
  zones: readonly Zone[];
  rates: readonly Rate[];
  businessId: string;
  stateId: number;
  lgaId: number;
  weightG: number;
  goodsKobo: bigint;
}): DeliveryQuote | null {
  const zone = zoneFor(params.zones, params.stateId, params.lgaId);
  if (!zone) return null;
  const zoneRates = params.rates.filter((r) => r.zoneId === zone.id);
  const own = zoneRates.filter((r) => r.businessId === params.businessId);
  // A seller with any rate for the zone has taken it over entirely.
  const pool = own.length ? own : zoneRates.filter((r) => r.businessId === null);
  const rate = pool.filter((r) => inBand(r, params.weightG)).sort((a, b) => a.minWeightG - b.minWeightG)[0];
  if (!rate) return null;
  const free = rate.freeOverKobo !== null && params.goodsKobo >= rate.freeOverKobo;
  return {
    zoneName: zone.name,
    feeKobo: free ? 0n : rate.feeKobo,
    free,
    freeOverKobo: rate.freeOverKobo,
    etaDaysMin: rate.etaDaysMin,
    etaDaysMax: rate.etaDaysMax,
  };
}
