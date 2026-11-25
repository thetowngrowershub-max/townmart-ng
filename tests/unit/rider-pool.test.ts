import { describe, expect, it } from "vitest";
import { rankPoolRiders, riderPay, LOCATION_FRESH_MS } from "@/lib/riders/pool";
import { poolApplicationSchema } from "@/lib/validation/riders";

describe("TownMart rider pay", () => {
  it("is the rider's share of the delivery fee, rounded down to the kobo", () => {
    expect(riderPay(100_000n, 80)).toBe(80_000n);
    expect(riderPay(75_050n, 80)).toBe(60_040n);
    expect(riderPay(33_333n, 80)).toBe(26_666n);
    expect(riderPay(0n, 80)).toBe(0n);
    expect(riderPay(100_000n, 150)).toBe(100_000n);
  });
});

describe("ranking pool riders for a pickup", () => {
  const now = new Date("2026-11-25T10:00:00Z");
  const shop = { lat: 6.812, lng: 3.439 };
  const r = (id: string, lat: number | null, lng: number | null, activeJobs = 0, ageMs = 60_000) => ({
    id,
    latitude: lat,
    longitude: lng,
    locationUpdatedAt: lat === null ? null : new Date(now.getTime() - ageMs),
    activeJobs,
  });

  it("puts the nearest first, riders with no recent position last, and leaves out full riders", () => {
    const ranked = rankPoolRiders([r("far", 6.85, 3.41), r("unknown", null, null), r("near", 6.813, 3.44), r("stale", 6.812, 3.439, 0, LOCATION_FRESH_MS + 1), r("full", 6.812, 3.439, 2)], shop, 2, now);
    expect(ranked.map((x) => x.id)).toEqual(["near", "far", "unknown", "stale"]);
    expect(ranked[0]!.metresToShop).toBeLessThan(200);
    expect(ranked[3]!.metresToShop).toBeNull();
  });
});

describe("rider applications", () => {
  const ok = { name: "Tunde Bello", phone: "0803 555 1234", vehicle: "motorbike", plateNumber: "kja 123 ab", homeTown: "Mowe", nin: "", guarantorName: "Mrs Bello", guarantorPhone: "08065551234", agree: true } as const;

  it("accepts a complete application and tidies the plate", () => {
    expect(poolApplicationSchema.parse(ok)).toMatchObject({ phone: "+2348035551234", plateNumber: "KJA 123 AB", nin: "" });
  });

  it("needs a plate for motor vehicles, an 11-digit NIN if given, and a different guarantor phone", () => {
    expect(poolApplicationSchema.safeParse({ ...ok, plateNumber: "" }).success).toBe(false);
    expect(poolApplicationSchema.safeParse({ ...ok, vehicle: "bicycle", plateNumber: "" }).success).toBe(true);
    expect(poolApplicationSchema.safeParse({ ...ok, nin: "1234" }).success).toBe(false);
    expect(poolApplicationSchema.parse({ ...ok, nin: "123 4567 8901" }).nin).toBe("12345678901");
    expect(poolApplicationSchema.safeParse({ ...ok, guarantorPhone: ok.phone }).success).toBe(false);
    expect(poolApplicationSchema.safeParse({ ...ok, agree: false }).success).toBe(false);
  });
});
