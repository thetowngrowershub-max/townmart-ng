import { describe, expect, it } from "vitest";
import { deliveryCode, parseRiderJobToken, riderJobToken, riderJobUrl, tokenMatches } from "@/lib/fulfilment/rider-job";

const so = { id: "0193a0c4-5b6e-7f00-8a1b-2c3d4e5f6a7b", riderId: "0193a0c4-0000-7000-8000-000000000001", riderAssignedAt: new Date("2026-11-19T10:00:00Z") };

describe("rider job link", () => {
  it("is short, names the order and matches only the current assignment", () => {
    const t = riderJobToken(so)!;
    expect(t).toMatch(/^[A-Za-z0-9_-]{34}$/);
    expect(parseRiderJobToken(t)).toBe(so.id);
    expect(tokenMatches(so, t)).toBe(true);
    // A new rider, or the same rider assigned again, kills the old link.
    expect(tokenMatches({ ...so, riderId: "0193a0c4-0000-7000-8000-000000000002" }, t)).toBe(false);
    expect(tokenMatches({ ...so, riderAssignedAt: new Date("2026-11-19T10:05:00Z") }, t)).toBe(false);
    expect(tokenMatches({ ...so, riderId: null, riderAssignedAt: null }, t)).toBe(false);
  });

  it("rejects tampered or malformed tokens", () => {
    const t = riderJobToken(so)!;
    const flipped = t.slice(0, -1) + (t.endsWith("A") ? "B" : "A");
    expect(tokenMatches(so, flipped)).toBe(false);
    expect(parseRiderJobToken("short")).toBeNull();
    expect(parseRiderJobToken("x".repeat(33) + "!")).toBeNull();
  });

  it("keeps the rider's text within one SMS", () => {
    expect(riderJobUrl(so)!.length).toBeLessThan(70);
  });
});

describe("delivery code", () => {
  it("is four digits, stable for an assignment and new for the next one", () => {
    const code = deliveryCode(so)!;
    expect(code).toMatch(/^\d{4}$/);
    expect(deliveryCode(so)).toBe(code);
    const others = new Set(Array.from({ length: 20 }, (_, i) => deliveryCode({ ...so, riderAssignedAt: new Date(so.riderAssignedAt.getTime() + (i + 1) * 1000) })));
    expect(others.size).toBeGreaterThan(10);
    expect(deliveryCode({ ...so, riderId: null, riderAssignedAt: null })).toBeNull();
  });
});
