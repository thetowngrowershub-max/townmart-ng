import type { UnitOfMeasure } from "@prisma/client";

export const UNITS: { value: UnitOfMeasure; label: string; fractional: boolean }[] = [
  { value: "piece", label: "Piece", fractional: false },
  { value: "pack", label: "Pack", fractional: false },
  { value: "kg", label: "Kilogram (kg)", fractional: true },
  { value: "litre", label: "Litre", fractional: true },
  { value: "bag", label: "Bag", fractional: false },
  { value: "crate", label: "Crate", fractional: false },
];

/** Only weight and volume can be sold in fractions (e.g. 1.5 kg of beef). */
export const unitAllowsFractions = (unit: UnitOfMeasure) => UNITS.find((u) => u.value === unit)?.fractional ?? false;

export const unitLabel = (unit: UnitOfMeasure, qty = 1) => {
  const short: Record<UnitOfMeasure, string> = { piece: "piece", pack: "pack", kg: "kg", litre: "litre", bag: "bag", crate: "crate" };
  const word = short[unit];
  return qty === 1 || unit === "kg" ? word : `${word}s`;
};

export const BUSINESS_TYPES = [
  { value: "retailer", label: "Retailer", sells: "products" },
  { value: "supermarket", label: "Supermarket", sells: "products" },
  { value: "vendor", label: "Vendor", sells: "products" },
  { value: "merchant", label: "Merchant", sells: "products" },
  { value: "producer", label: "Producer / farm", sells: "products" },
  { value: "service_provider", label: "Service provider", sells: "services" },
  { value: "artisan", label: "Artisan", sells: "services" },
] as const;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const minutesToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const timeToMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
