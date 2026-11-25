import { describe, expect, it } from "vitest";
import { dateToLagosLocal, lagosLocalToDate } from "@/lib/datetime";

describe("Lagos datetime-local values", () => {
  it("reads form values as Lagos time whatever the server's timezone", () => {
    expect(lagosLocalToDate("2026-12-24T09:00").toISOString()).toBe("2026-12-24T08:00:00.000Z");
    expect(lagosLocalToDate("2026-12-31T23:30").toISOString()).toBe("2026-12-31T22:30:00.000Z");
  });

  it("round-trips", () => {
    expect(dateToLagosLocal(lagosLocalToDate("2027-01-01T00:15"))).toBe("2027-01-01T00:15");
  });
});
