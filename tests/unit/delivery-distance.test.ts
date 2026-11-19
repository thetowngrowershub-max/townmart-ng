import { describe, expect, it } from "vitest";
import { quoteDistanceDelivery } from "@/lib/checkout/delivery";
import { rankRiders } from "@/lib/fulfilment/riders";
import { nearServiceArea, parseNearCookie, resolveCustomerPoint } from "@/lib/geo/customer-location";
import { formatDistance, haversineMetres, priceByDistance, roadMetres } from "@/lib/geo/distance";
import { googleRoadMetres } from "@/lib/geo/routes";

const MOWE = { lat: 6.809, lng: 3.437 };
const rates = { perKmKobo: 25_000n, roadFactor: 1.3, maxKm: 25 };

describe("distance", () => {
  it("measures straight-line distance", () => {
    // One thousandth of a degree of latitude is about 111 m.
    expect(haversineMetres(MOWE, { lat: MOWE.lat + 0.01, lng: MOWE.lng })).toBeGreaterThan(1100);
    expect(haversineMetres(MOWE, { lat: MOWE.lat + 0.01, lng: MOWE.lng })).toBeLessThan(1125);
    expect(haversineMetres(MOWE, MOWE)).toBe(0);
  });

  it("estimates road distance with the road factor", () => {
    const b = { lat: MOWE.lat + 0.01, lng: MOWE.lng };
    expect(roadMetres(MOWE, b, 1.3)).toBe(Math.round(haversineMetres(MOWE, b) * 1.3));
  });

  it("formats distances", () => {
    expect(formatDistance(420)).toBe("400 m");
    expect(formatDistance(1460)).toBe("1.5 km");
    expect(formatDistance(12_400)).toBe("12 km");
  });
});

describe("priceByDistance", () => {
  it("charges ₦250 per km, rounded up to the next km", () => {
    expect(priceByDistance(3_200, rates)).toEqual({ metres: 3_200, chargedKm: 4, feeKobo: 100_000n });
    expect(priceByDistance(5_000, rates)?.feeKobo).toBe(125_000n);
  });

  it("charges at least 1 km", () => {
    expect(priceByDistance(0, rates)).toEqual({ metres: 0, chargedKm: 1, feeKobo: 25_000n });
    expect(priceByDistance(300, rates)?.feeKobo).toBe(25_000n);
  });

  it("refuses deliveries beyond the limit", () => {
    expect(priceByDistance(25_000, rates)).not.toBeNull();
    expect(priceByDistance(25_001, rates)).toBeNull();
  });
});

describe("quoteDistanceDelivery", () => {
  it("prices the road distance, same or next day", () => {
    const q = quoteDistanceDelivery({ road: { metres: 3_300, method: "road" }, source: "gps", rates })!;
    expect(q.distance).toMatchObject({ metres: 3_300, chargedKm: 4, source: "gps", method: "road" });
    expect(q.feeKobo).toBe(100_000n);
    expect([q.etaDaysMin, q.etaDaysMax]).toEqual([0, 1]);
  });
});

describe("googleRoadMetres", () => {
  const from = MOWE;
  const to = { lat: 6.83, lng: 3.425 };
  it("reads the driving distance from Google Routes", async () => {
    let sent: RequestInit | undefined;
    const fake = (async (_url: string, init?: RequestInit) => {
      sent = init;
      return new Response(JSON.stringify({ routes: [{ distanceMeters: 4123 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await googleRoadMetres(from, to, "test-key", fake)).toBe(4123);
    expect((sent?.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("routes.distanceMeters");
    expect(JSON.parse(String(sent?.body)).travelMode).toBe("DRIVE");
  });

  it("gives up quietly when Google fails, so checkout falls back to the estimate", async () => {
    const denied = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const empty = (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
    expect(await googleRoadMetres(from, to, "k", denied)).toBeNull();
    expect(await googleRoadMetres(from, to, "k", down)).toBeNull();
    expect(await googleRoadMetres(from, to, "k", empty)).toBeNull();
  });
});

describe("resolveCustomerPoint", () => {
  const area = { stateSlug: "ogun", lgaSlug: "obafemi-owode" };

  it("prefers the phone's location inside the area", () => {
    const r = resolveCustomerPoint({ gps: { lat: 6.8123456, lng: 3.4401234 }, pinned: { latitude: 6.8, longitude: 3.4 }, area });
    expect(r).toEqual({ point: { lat: 6.81235, lng: 3.44012, source: "gps" }, problem: null });
  });

  it("ignores a phone far from the area, and says so", () => {
    const lagos = { lat: 6.5244, lng: 3.3792 };
    expect(nearServiceArea(lagos)).toBe(false);
    const r = resolveCustomerPoint({ gps: lagos, pinned: null, area });
    expect(r.point?.source).toBe("area");
    expect(r.problem).toBe("outside_area");
  });

  it("falls back to the saved pin, then the town centre", () => {
    expect(resolveCustomerPoint({ pinned: { latitude: 6.82, longitude: 3.44 }, area }).point).toEqual({ lat: 6.82, lng: 3.44, source: "pinned" });
    expect(resolveCustomerPoint({ pinned: { latitude: null, longitude: null }, area }).point).toEqual({ ...MOWE, source: "area" });
    expect(resolveCustomerPoint({ area: { stateSlug: "lagos", lgaSlug: "ikeja" } }).point).toBeNull();
  });

  it("reads the near-me cookie only inside the area", () => {
    expect(parseNearCookie("6.812,3.439")).toEqual({ lat: 6.812, lng: 3.439 });
    expect(parseNearCookie("6.524,3.379")).toBeNull();
    expect(parseNearCookie("rubbish")).toBeNull();
    expect(parseNearCookie(undefined)).toBeNull();
  });
});

describe("rankRiders", () => {
  const base = { vehicle: "motorbike", locationUpdatedAt: null };
  it("puts free, nearby riders first, nearest first", () => {
    const ranked = rankRiders(
      [
        { ...base, id: "far", name: "Far", isAvailable: true, latitude: MOWE.lat + 0.1, longitude: MOWE.lng, activeJobs: 0 },
        { ...base, id: "busy", name: "Busy", isAvailable: true, latitude: null, longitude: null, activeJobs: 1 },
        { ...base, id: "off", name: "Off", isAvailable: false, latitude: null, longitude: null, activeJobs: 0 },
        { ...base, id: "near", name: "Near", isAvailable: true, latitude: MOWE.lat + 0.01, longitude: MOWE.lng, activeJobs: 0 },
        { ...base, id: "shop", name: "At shop", isAvailable: true, latitude: null, longitude: null, activeJobs: 0 },
      ],
      MOWE,
      5,
    );
    expect(ranked.map((r) => r.id)).toEqual(["shop", "near", "far", "busy", "off"]);
    expect(ranked.filter((r) => r.suggested).map((r) => r.id)).toEqual(["shop", "near"]);
    expect(ranked.find((r) => r.id === "far")?.metresToShop).toBeGreaterThan(10_000);
  });
});
