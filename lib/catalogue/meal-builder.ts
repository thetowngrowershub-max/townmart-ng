/**
 * Meal builder for restaurants: a menu item whose plate the customer puts
 * together before checkout, e.g. a meal (rice, swallow, yam, plantain...),
 * a soup for the swallow, a protein and a drink.
 *
 * Stored on Product.mealBuilder (JSON). The price of one plate is the
 * variant's price (the pack, or a base dish) plus each chosen item's price
 * times its quantity. Swallow is sold by the wrap: a swallow item asks how
 * many wraps, and a group marked `withSwallow` (soups) only appears, and is
 * then required, once a swallow is on the plate.
 *
 * Choices travel as { [groupKey]: { [itemKey]: qty } }. Prices are always
 * read from the product on the server, never from the shopper.
 */
import { slugify } from "@/lib/slug";

export type MealItem = {
  key: string;
  name: string;
  priceKobo: number;
  /** What one unit is: "wrap" for swallow, "portion", "piece", "bottle"... */
  unit: string;
  /** Most units of this item on one plate (e.g. 6 wraps). 1 = a simple tick box. */
  maxQty: number;
  /** Units pre-filled when the customer picks it (e.g. 2 wraps). */
  defaultQty: number;
  swallow: boolean;
  available: boolean;
};

export type MealGroup = {
  key: string;
  name: string;
  /** Fewest and most different items the customer picks in this group. min 0 = optional. */
  min: number;
  max: number;
  /** Only shown (and only required) when a swallow is on the plate: soups. */
  withSwallow: boolean;
  items: MealItem[];
};

export type MealBuilder = { groups: MealGroup[] };
export type MealChoices = Record<string, Record<string, number>>;

const int = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : dflt);

/** Reads the stored JSON. Anything malformed means "no meal builder". */
export function parseMealBuilder(value: unknown): MealBuilder | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as MealBuilder).groups)) return null;
  const groups: MealGroup[] = [];
  for (const g of (value as { groups: unknown[] }).groups) {
    if (!g || typeof g !== "object") return null;
    const gg = g as Record<string, unknown>;
    if (typeof gg.key !== "string" || typeof gg.name !== "string" || !Array.isArray(gg.items)) return null;
    const items: MealItem[] = [];
    for (const i of gg.items as Record<string, unknown>[]) {
      if (!i || typeof i.key !== "string" || typeof i.name !== "string" || typeof i.priceKobo !== "number" || i.priceKobo < 0) return null;
      const maxQty = int(i.maxQty, 1, 20, 1);
      items.push({
        key: i.key,
        name: i.name,
        priceKobo: i.priceKobo,
        unit: typeof i.unit === "string" && i.unit ? i.unit : "portion",
        maxQty,
        defaultQty: Math.min(int(i.defaultQty, 1, 20, 1), maxQty),
        swallow: i.swallow === true,
        available: i.available !== false,
      });
    }
    const max = int(gg.max, 1, 20, 1);
    groups.push({ key: gg.key, name: gg.name, min: Math.min(int(gg.min, 0, 20, 0), max), max, withSwallow: gg.withSwallow === true, items });
  }
  return groups.length ? { groups } : null;
}

const plural = (n: number, unit: string) => (n === 1 ? unit : unit.endsWith("s") ? unit : `${unit}s`);

/** "Amala × 3 wraps", "Fried plantain", "Chicken × 2 pieces". */
export function choiceLabel(item: Pick<MealItem, "name" | "unit" | "swallow">, qty: number): string {
  // Swallow always says how many wraps; anything else only when there's more than one.
  if (qty === 1 && !item.swallow) return item.name;
  return `${item.name} × ${qty} ${plural(qty, item.unit)}`;
}

export type CheckedChoices = {
  /** Added to the variant's price for one plate. */
  extraKobo: bigint;
  /** One line per group, for the cart, order and receipts: { "Meal": "Amala × 3 wraps, Fried plantain" }. */
  labels: Record<string, string>;
  /** The choices without zero quantities, in the builder's order. */
  choices: MealChoices;
  /** Same plate = same key, so it stacks in the cart; a different plate is a separate line. */
  key: string;
};

export class MealChoiceError extends Error {}

/** Whether the plate has a swallow on it. */
export function hasSwallow(builder: MealBuilder, choices: MealChoices): boolean {
  return builder.groups.some((g) => g.items.some((i) => i.swallow && (choices[g.key]?.[i.key] ?? 0) > 0));
}

/** Groups the customer sees for these choices (soups only once a swallow is picked). */
export function visibleGroups(builder: MealBuilder, choices: MealChoices): MealGroup[] {
  const swallow = hasSwallow(builder, choices);
  return builder.groups.filter((g) => !g.withSwallow || swallow);
}

/**
 * Checks a plate against the builder and prices it. Throws MealChoiceError
 * with a message for the customer when something is missing or not allowed.
 */
export function checkChoices(builder: MealBuilder, raw: unknown): CheckedChoices {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const choices: MealChoices = {};
  for (const g of builder.groups) {
    const picked = input[g.key];
    if (!picked || typeof picked !== "object") continue;
    for (const [itemKey, q] of Object.entries(picked as Record<string, unknown>)) {
      const item = g.items.find((i) => i.key === itemKey);
      if (!item) throw new MealChoiceError("Some of your choices are no longer on the menu. Please choose again.");
      const qty = typeof q === "number" ? q : Number(q);
      if (!Number.isInteger(qty) || qty < 0 || qty > item.maxQty) throw new MealChoiceError(`Choose up to ${item.maxQty} ${plural(item.maxQty, item.unit)} of ${item.name}.`);
      if (qty === 0) continue;
      if (!item.available) throw new MealChoiceError(`${item.name} is finished for today. Please choose something else.`);
      (choices[g.key] ??= {})[item.key] = qty;
    }
  }
  // Leftover choices in a soup group when there's no swallow are dropped, not an error.
  const swallow = hasSwallow(builder, choices);
  let extra = 0n;
  const labels: Record<string, string> = {};
  for (const g of builder.groups) {
    if (g.withSwallow && !swallow) {
      delete choices[g.key];
      continue;
    }
    const picked = g.items.filter((i) => (choices[g.key]?.[i.key] ?? 0) > 0);
    if (picked.length < g.min) throw new MealChoiceError(g.min === 1 ? `Choose a ${g.name.toLowerCase()}.` : `Choose at least ${g.min} for ${g.name.toLowerCase()}.`);
    if (picked.length > g.max) throw new MealChoiceError(`Choose at most ${g.max} for ${g.name.toLowerCase()}.`);
    if (!picked.length) continue;
    labels[g.name] = picked.map((i) => choiceLabel(i, choices[g.key]![i.key]!)).join(", ");
    for (const i of picked) extra += BigInt(i.priceKobo) * BigInt(choices[g.key]![i.key]!);
  }
  const canonical = JSON.stringify(builder.groups.filter((g) => choices[g.key]).map((g) => [g.key, g.items.filter((i) => choices[g.key]![i.key]).map((i) => [i.key, choices[g.key]![i.key]])]));
  const key = Object.keys(choices).length ? canonical : "";
  return { extraKobo: extra, labels, choices, key };
}

/** The cheapest plate's add-ons (the fewest required choices at their lowest prices), for "from" prices on listings. */
export function cheapestPlateKobo(groups: { min: number; withSwallow: boolean; items: { priceKobo: number; available?: boolean }[] }[]): bigint {
  let total = 0n;
  for (const g of groups) {
    if (g.withSwallow || g.min === 0) continue;
    const prices = g.items.filter((i) => i.available !== false).map((i) => i.priceKobo).sort((a, b) => a - b);
    for (const p of prices.slice(0, g.min)) total += BigInt(p);
  }
  return total;
}

/** Builds a stored builder from what the seller typed, giving each group and item a stable key. */
export function withKeys<G extends { key?: string; name: string; items: { key?: string; name: string }[] }>(groups: G[]) {
  const used = new Set<string>();
  const unique = (base: string) => {
    let k = base || "item";
    for (let n = 2; used.has(k); n++) k = `${base}-${n}`;
    used.add(k);
    return k;
  };
  return groups.map((g) => {
    const key = unique(g.key || slugify(g.name));
    const itemKeys = new Set<string>();
    return {
      ...g,
      key,
      items: g.items.map((i) => {
        let k = i.key || slugify(i.name) || "item";
        for (let n = 2; itemKeys.has(k); n++) k = `${slugify(i.name)}-${n}`;
        itemKeys.add(k);
        return { ...i, key: k };
      }),
    };
  });
}

/** A starting point for a Nigerian plate; the seller edits names and prices. Prices in naira. */
export const NIGERIAN_PLATE_TEMPLATE = [
  {
    name: "Meal",
    min: "1",
    max: "2",
    withSwallow: false,
    items: [
      { name: "Jollof rice", price: "1500", unit: "portion", maxQty: "2", defaultQty: "1", swallow: false, available: true },
      { name: "Fried rice", price: "1500", unit: "portion", maxQty: "2", defaultQty: "1", swallow: false, available: true },
      { name: "White rice", price: "1000", unit: "portion", maxQty: "2", defaultQty: "1", swallow: false, available: true },
      { name: "Amala", price: "300", unit: "wrap", maxQty: "6", defaultQty: "2", swallow: true, available: true },
      { name: "Pounded yam", price: "500", unit: "wrap", maxQty: "6", defaultQty: "2", swallow: true, available: true },
      { name: "Eba", price: "250", unit: "wrap", maxQty: "6", defaultQty: "2", swallow: true, available: true },
      { name: "Fufu", price: "300", unit: "wrap", maxQty: "6", defaultQty: "2", swallow: true, available: true },
      { name: "Semo", price: "300", unit: "wrap", maxQty: "6", defaultQty: "2", swallow: true, available: true },
      { name: "Boiled yam", price: "800", unit: "portion", maxQty: "2", defaultQty: "1", swallow: false, available: true },
      { name: "Fried plantain (dodo)", price: "500", unit: "portion", maxQty: "3", defaultQty: "1", swallow: false, available: true },
      { name: "Roasted plantain (boli)", price: "600", unit: "portion", maxQty: "3", defaultQty: "1", swallow: false, available: true },
    ],
  },
  {
    name: "Soup",
    min: "1",
    max: "2",
    withSwallow: true,
    items: [
      { name: "Ewedu and gbegiri", price: "500", unit: "portion", maxQty: "1", defaultQty: "1", swallow: false, available: true },
      { name: "Egusi", price: "700", unit: "portion", maxQty: "1", defaultQty: "1", swallow: false, available: true },
      { name: "Efo riro", price: "700", unit: "portion", maxQty: "1", defaultQty: "1", swallow: false, available: true },
      { name: "Okra", price: "600", unit: "portion", maxQty: "1", defaultQty: "1", swallow: false, available: true },
    ],
  },
  {
    name: "Protein",
    min: "1",
    max: "3",
    withSwallow: false,
    items: [
      { name: "Beef", price: "500", unit: "piece", maxQty: "4", defaultQty: "1", swallow: false, available: true },
      { name: "Assorted beef", price: "800", unit: "portion", maxQty: "3", defaultQty: "1", swallow: false, available: true },
      { name: "Chicken", price: "1500", unit: "piece", maxQty: "3", defaultQty: "1", swallow: false, available: true },
      { name: "Turkey", price: "2000", unit: "piece", maxQty: "3", defaultQty: "1", swallow: false, available: true },
      { name: "Fish", price: "1200", unit: "piece", maxQty: "3", defaultQty: "1", swallow: false, available: true },
      { name: "Ponmo", price: "300", unit: "piece", maxQty: "4", defaultQty: "1", swallow: false, available: true },
    ],
  },
  {
    name: "Drink",
    min: "0",
    max: "2",
    withSwallow: false,
    items: [
      { name: "Bottled water", price: "300", unit: "bottle", maxQty: "4", defaultQty: "1", swallow: false, available: true },
      { name: "Soft drink", price: "500", unit: "bottle", maxQty: "4", defaultQty: "1", swallow: false, available: true },
      { name: "Malt", price: "700", unit: "bottle", maxQty: "4", defaultQty: "1", swallow: false, available: true },
      { name: "Zobo", price: "600", unit: "bottle", maxQty: "4", defaultQty: "1", swallow: false, available: true },
    ],
  },
];
