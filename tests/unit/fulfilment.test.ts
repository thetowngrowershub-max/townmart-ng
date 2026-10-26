import { describe, expect, it } from "vitest";
import { can, type Actor } from "@/lib/authz";
import { sellerBookingSteps } from "@/lib/bookings/manage";
import { findSlot, generateSlots, lagosWeekday, type WeeklyWindow } from "@/lib/bookings/slots";
import { buildQuote, type QuoteLine } from "@/lib/checkout/quote";
import type { PricedCart, PricedLine } from "@/lib/pricing";
import { nextSteps } from "@/lib/fulfilment/orders";
import { shortName } from "@/lib/reviews/reviews";
import { zoneRatesSchema } from "@/lib/validation/delivery-rates";

const at = (s: string) => new Date(`${s}+01:00`);
// Monday 2 November 2026, Lagos time.
const MON = 1;
const window = (w: Partial<WeeklyWindow> = {}): WeeklyWindow => ({ weekday: MON, startMinute: 9 * 60, endMinute: 12 * 60, slotMinutes: 60, bufferMinutes: 0, maxPerSlot: 1, ...w });
const base = { blackouts: [], booked: [], durationMinutes: 60, from: at("2026-11-02T00:00:00"), to: at("2026-11-03T00:00:00"), earliest: at("2026-11-01T00:00:00") };

describe("booking slots", () => {
  it("works out weekdays in Lagos time, not UTC", () => {
    // 23:30 UTC on Sunday is already Monday in Lagos.
    expect(lagosWeekday(new Date("2026-11-01T23:30:00Z"))).toBe(MON);
  });

  it("puts slots on the weekly grid, each finishing inside the window", () => {
    const slots = generateSlots({ ...base, windows: [window()], durationMinutes: 90 });
    expect(slots.map((s) => s.startsAt)).toEqual([at("2026-11-02T09:00:00"), at("2026-11-02T10:00:00")]);
    expect(slots[0]!.endsAt).toEqual(at("2026-11-02T10:30:00"));
  });

  it("leaves a buffer between slots and skips other weekdays", () => {
    const slots = generateSlots({ ...base, windows: [window({ bufferMinutes: 30 }), window({ weekday: 2 })] });
    expect(slots.map((s) => s.startsAt)).toEqual([at("2026-11-02T09:00:00"), at("2026-11-02T10:30:00")]);
  });

  it("counts places left and drops full times when asked", () => {
    const booked = [{ startsAt: at("2026-11-02T09:00:00"), endsAt: at("2026-11-02T10:00:00") }];
    const slots = generateSlots({ ...base, windows: [window({ maxPerSlot: 2 })], booked: [...booked, ...booked] });
    expect(slots[0]).toMatchObject({ capacity: 2, remaining: 0 });
    expect(slots[1]).toMatchObject({ capacity: 2, remaining: 2 });
    expect(generateSlots({ ...base, windows: [window({ maxPerSlot: 2 })], booked: [...booked, ...booked], onlyOpen: true })).toHaveLength(2);
  });

  it("leaves out blackouts and times inside the lead time", () => {
    const blackouts = [{ startsAt: at("2026-11-02T10:30:00"), endsAt: at("2026-11-02T11:00:00") }];
    const slots = generateSlots({ ...base, windows: [window()], blackouts, earliest: at("2026-11-02T09:30:00") });
    expect(slots.map((s) => s.startsAt)).toEqual([at("2026-11-02T11:00:00")]);
  });

  it("only accepts a chosen time that is on the grid", () => {
    expect(findSlot({ ...base, windows: [window()] }, at("2026-11-02T10:00:00"))).toMatchObject({ remaining: 1 });
    expect(findSlot({ ...base, windows: [window()] }, at("2026-11-02T10:15:00"))).toBeNull();
    expect(findSlot({ ...base, windows: [window()] }, at("2026-11-02T12:00:00"))).toBeNull();
  });
});

describe("seller steps", () => {
  const now = at("2026-11-02T10:00:00");
  it("offers a booking's next step, and a no-show only once the time has come", () => {
    expect(sellerBookingSteps({ status: "requested", startsAt: at("2026-11-03T10:00:00") }, now)).toEqual(["confirm"]);
    expect(sellerBookingSteps({ status: "confirmed", startsAt: at("2026-11-03T10:00:00") }, now)).toEqual(["start"]);
    expect(sellerBookingSteps({ status: "confirmed", startsAt: at("2026-11-02T09:00:00") }, now)).toEqual(["start", "no_show"]);
    expect(sellerBookingSteps({ status: "completed", startsAt: now }, now)).toEqual([]);
  });

  it("offers an order's next step for delivery and pickup, and none for bookings", () => {
    expect(nextSteps({ status: "paid", deliveryMethod: "delivery" })).toEqual(["processing"]);
    expect(nextSteps({ status: "processing", deliveryMethod: "delivery" })).toEqual(["shipped"]);
    expect(nextSteps({ status: "processing", deliveryMethod: "pickup" })).toEqual(["ready_for_pickup"]);
    expect(nextSteps({ status: "shipped", deliveryMethod: "delivery" })).toEqual(["delivered"]);
    expect(nextSteps({ status: "delivered", deliveryMethod: "delivery" })).toEqual([]);
    expect(nextSteps({ status: "paid", deliveryMethod: "none" })).toEqual([]);
  });
});

describe("deposits", () => {
  it("takes only the deposit now and records the rest as paid on the day", () => {
    const line: QuoteLine = { key: "cut", businessId: "s1", categoryId: "cat", parentCategoryId: null, payLaterKobo: 1_750_000n };
    const pl: PricedLine = { key: "cut", subtotalKobo: 2_500_000n, discountKobo: 0n, totalKobo: 2_500_000n, promotions: [], parts: [] };
    const priced: PricedCart = { lines: [pl], subtotalKobo: 2_500_000n, discountKobo: 0n, totalKobo: 2_500_000n, coupon: { state: "none" } as PricedCart["coupon"], redemptions: [] };
    const q = buildQuote({ lines: [line], priced, deliveryKobo: new Map(), commissionRules: [], defaultCommissionBps: 500, serviceFeeBps: 0, serviceFeeCapKobo: 0n, vatBps: 750, now: new Date() });
    expect(q.payLaterKobo).toBe(1_750_000n);
    expect(q.totalKobo).toBe(750_000n);
    // Commission is on the whole booking; the seller collects the balance themselves.
    expect(q.sellers[0]!.commissionKobo).toBe(125_000n);
    expect(q.sellers[0]!.payLaterKobo).toBe(1_750_000n);
  });
});

describe("order and review permissions", () => {
  const A = "biz-a";
  const owner: Actor = { id: "o", roles: ["merchant"], businesses: [{ id: A, role: "owner" }] };
  const frontDesk: Actor = { id: "f", roles: ["staff"], businesses: [{ id: A, role: "staff", permissions: { bookings: true } }] };
  const packer: Actor = { id: "p", roles: ["staff"], businesses: [{ id: A, role: "staff", permissions: { orders: true } }] };
  const admin: Actor = { id: "a", roles: ["admin"] };

  it("gives owners order, booking and review access to their own business only", () => {
    for (const p of ["order.read", "order.manage", "booking.manage", "review.manage"] as const) {
      expect(can(owner, p, { businessId: A })).toBe(true);
      expect(can(owner, p, { businessId: "biz-b" })).toBe(false);
    }
  });

  it("splits orders and bookings between staff flags", () => {
    expect(can(packer, "order.manage", { businessId: A })).toBe(true);
    expect(can(packer, "booking.manage", { businessId: A })).toBe(false);
    expect(can(frontDesk, "booking.manage", { businessId: A })).toBe(true);
    expect(can(frontDesk, "order.manage", { businessId: A })).toBe(false);
    expect(can(packer, "review.manage", { businessId: A })).toBe(false);
  });

  it("lets admins read any order but not act for the seller", () => {
    expect(can(admin, "order.read", { businessId: A })).toBe(true);
    expect(can(admin, "order.manage", { businessId: A })).toBe(false);
    expect(can(admin, "review.manage", { businessId: A })).toBe(false);
  });
});

describe("reviews and delivery rates", () => {
  it("shows reviewers by first name and initial only", () => {
    expect(shortName("Adaeze Ngozi Okafor")).toBe("Adaeze O.");
    expect(shortName("Tunde")).toBe("Tunde");
    expect(shortName("  ")).toBe("TownMart shopper");
  });

  it("accepts weight bands that rise, with only the last left open", () => {
    const band = (upToKg: string) => ({ upToKg, fee: "1500", freeOver: "", etaMin: "1", etaMax: "2" });
    const ok = zoneRatesSchema.safeParse({ zoneId: "0190e4b0-0000-7000-8000-000000000000", bands: [band("2"), band("10"), band("")] });
    expect(ok.success && ok.data.bands.map((b) => b.upToKg)).toEqual([2000, 10000, null]);
    const falling = zoneRatesSchema.safeParse({ zoneId: "0190e4b0-0000-7000-8000-000000000000", bands: [band("5"), band("2")] });
    expect(falling.success).toBe(false);
    const openMiddle = zoneRatesSchema.safeParse({ zoneId: "0190e4b0-0000-7000-8000-000000000000", bands: [band(""), band("2")] });
    expect(openMiddle.success).toBe(false);
  });
});
