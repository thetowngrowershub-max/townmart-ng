import { describe, expect, it } from "vitest";
import { cheapestPlateKobo, checkChoices, MealChoiceError, parseMealBuilder, visibleGroups, withKeys, NIGERIAN_PLATE_TEMPLATE } from "@/lib/catalogue/meal-builder";
import { productInputSchema } from "@/lib/validation/catalogue";

// The template as the dashboard would store it: keys added, prices in kobo.
const builder = parseMealBuilder({
  groups: withKeys(NIGERIAN_PLATE_TEMPLATE).map((g) => ({
    key: g.key,
    name: g.name,
    min: Number(g.min),
    max: Number(g.max),
    withSwallow: g.withSwallow,
    items: g.items.map((i) => ({ ...i, priceKobo: Number(i.price) * 100, maxQty: Number(i.maxQty), defaultQty: Number(i.defaultQty), available: i.name !== "Turkey" })),
  })),
})!;

describe("meal builder", () => {
  it("prices a plate from what's on it", () => {
    const plate = checkChoices(builder, { meal: { "jollof-rice": 1, "fried-plantain-dodo": 1 }, protein: { chicken: 1 }, drink: { zobo: 1 } });
    // 1,500 + 500 + 1,500 + 600
    expect(plate.extraKobo).toBe(410_000n);
    expect(plate.labels).toEqual({ Meal: "Jollof rice, Fried plantain (dodo)", Protein: "Chicken", Drink: "Zobo" });
  });

  it("sells swallow by the wrap and asks for a soup with it", () => {
    expect(visibleGroups(builder, {}).map((g) => g.name)).toEqual(["Meal", "Protein", "Drink"]);
    expect(visibleGroups(builder, { meal: { amala: 3 } }).map((g) => g.name)).toEqual(["Meal", "Soup", "Protein", "Drink"]);
    expect(() => checkChoices(builder, { meal: { amala: 3 }, protein: { beef: 2 } })).toThrow("Choose a soup.");
    const plate = checkChoices(builder, { meal: { amala: 3 }, soup: { "ewedu-and-gbegiri": 1 }, protein: { "assorted-beef": 1, ponmo: 2 } });
    // 3 wraps × 300 + 500 + 800 + 2 × 300
    expect(plate.extraKobo).toBe(280_000n);
    expect(plate.labels).toMatchObject({ Meal: "Amala × 3 wraps", Protein: "Assorted beef, Ponmo × 2 pieces" });
  });

  it("drops a soup left over when the swallow is taken off", () => {
    const plate = checkChoices(builder, { meal: { "white-rice": 1 }, soup: { egusi: 1 }, protein: { fish: 1 } });
    expect(plate.choices.soup).toBeUndefined();
    expect(plate.extraKobo).toBe(220_000n);
  });

  it("refuses missing steps, too many choices, too many wraps and finished items", () => {
    expect(() => checkChoices(builder, { meal: { "jollof-rice": 1 } })).toThrow(MealChoiceError);
    expect(() => checkChoices(builder, { meal: { "jollof-rice": 1, "fried-rice": 1, "white-rice": 1 }, protein: { beef: 1 } })).toThrow("at most 2");
    expect(() => checkChoices(builder, { meal: { amala: 7 }, soup: { egusi: 1 }, protein: { beef: 1 } })).toThrow("up to 6 wraps");
    expect(() => checkChoices(builder, { meal: { "jollof-rice": 1 }, protein: { turkey: 1 } })).toThrow("finished for today");
    expect(() => checkChoices(builder, { meal: { caviar: 1 }, protein: { beef: 1 } })).toThrow("no longer on the menu");
  });

  it("gives the same plate the same key, whatever order it was chosen in", () => {
    const a = checkChoices(builder, { protein: { beef: 1 }, meal: { "jollof-rice": 1, "white-rice": 1 } });
    const b = checkChoices(builder, { meal: { "white-rice": 1, "jollof-rice": 1 }, protein: { beef: 1, chicken: 0 } });
    const c = checkChoices(builder, { meal: { "jollof-rice": 2 }, protein: { beef: 1 } });
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });

  it("lists at the cheapest plate", () => {
    // Cheapest meal (eba 250) + cheapest protein (ponmo 300); soup and drink aren't required up front.
    expect(cheapestPlateKobo(builder.groups)).toBe(55_000n);
  });

  it("validates what the seller types", () => {
    const base = { title: "Build your plate", categoryId: "0190f3a4-6c8b-7d1e-9f00-000000000001", unit: "piece", minOrderQty: "1", allowFractionalQty: false, trackInventory: false, allowBackorder: false, isPerishable: false, status: "draft", tags: "", options: [], images: [], variants: [{ sku: "PLATE", optionValues: {}, price: "200", stockQty: "0", lowStockThreshold: "0" }] } as const;
    expect(productInputSchema.safeParse({ ...base, mealBuilder: NIGERIAN_PLATE_TEMPLATE }).success).toBe(true);
    const bad = productInputSchema.safeParse({ ...base, mealBuilder: [{ name: "Protein", min: "3", max: "2", withSwallow: false, items: [{ name: "Beef", price: "500", unit: "piece", maxQty: "2", defaultQty: "3", swallow: false, available: true }] }] });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.message)).toEqual(expect.arrayContaining(["Can't be more than the most per plate", "Can't be more than the most"]));
  });
});
