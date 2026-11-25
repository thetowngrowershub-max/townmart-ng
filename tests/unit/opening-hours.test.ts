import { describe, expect, it } from "vitest";
import { describeWeek, formatClock, openState, parseOpeningHours, prepTimeLabel, type WeekHours } from "@/lib/catalogue/opening-hours";
import { openingHoursSchema } from "@/lib/validation/seller";

// Sunday noon to 9 pm; Monday to Saturday 8 am to 10 pm; Wednesday closed.
const WEEK: WeekHours = [{ open: 720, close: 1260 }, { open: 480, close: 1320 }, { open: 480, close: 1320 }, null, { open: 480, close: 1320 }, { open: 480, close: 1320 }, { open: 480, close: 1440 }];

// 2026-11-17 is a Tuesday. Lagos is UTC+1.
const lagos = (iso: string) => new Date(`${iso}+01:00`);

describe("opening hours", () => {
  it("is open inside the day's hours, in Lagos time", () => {
    expect(openState(WEEK, false, lagos("2026-11-17T12:00:00"))).toMatchObject({ open: true, label: "Open now · closes 10:00 pm" });
    // 07:30 UTC is 08:30 in Lagos: open.
    expect(openState(WEEK, false, new Date("2026-11-17T07:30:00Z")).open).toBe(true);
  });

  it("is closed before opening, after closing and on closed days, and says when it opens", () => {
    expect(openState(WEEK, false, lagos("2026-11-17T07:00:00")).label).toBe("Closed · opens 8:00 am today");
    expect(openState(WEEK, false, lagos("2026-11-17T22:00:00"))).toMatchObject({ open: false, reason: "closed", label: "Closed · opens 8:00 am Thursday" });
    expect(openState(WEEK, false, lagos("2026-11-18T12:00:00")).label).toBe("Closed · opens 8:00 am tomorrow");
  });

  it("handles a midnight close", () => {
    expect(openState(WEEK, false, lagos("2026-11-21T23:59:00")).open).toBe(true);
    expect(openState(WEEK, false, lagos("2026-11-22T00:30:00")).label).toBe("Closed · opens 12:00 pm today");
  });

  it("pausing overrides the hours; no hours means always open", () => {
    expect(openState(WEEK, true, lagos("2026-11-17T12:00:00"))).toMatchObject({ open: false, reason: "paused" });
    expect(openState(null, false, lagos("2026-11-18T03:00:00")).open).toBe(true);
    expect(openState(null, true).open).toBe(false);
  });

  it("ignores malformed stored hours", () => {
    expect(parseOpeningHours(null)).toBeNull();
    expect(parseOpeningHours([null, null])).toBeNull();
    expect(parseOpeningHours(Array(7).fill({ open: 600, close: 500 }))).toBeNull();
    expect(parseOpeningHours(WEEK)).toEqual(WEEK);
  });

  it("formats times, the week and prep times", () => {
    expect(formatClock(0)).toBe("12:00 am");
    expect(formatClock(750)).toBe("12:30 pm");
    expect(formatClock(1440)).toBe("midnight");
    expect(describeWeek(WEEK)[0]).toEqual(["Monday", "8:00 am – 10:00 pm"]);
    expect(describeWeek(WEEK)[2]).toEqual(["Wednesday", "Closed"]);
    expect(prepTimeLabel(20)).toBe("Ready in about 20 min");
    expect(prepTimeLabel(90)).toBe("Ready in about 1 hr 30 min");
    expect(prepTimeLabel(1440)).toBe("Ready in about 24 hrs");
  });
});

describe("opening hours form", () => {
  const day = (isOpen: boolean, open = "08:00", close = "22:00") => ({ isOpen, open, close });
  it("needs closing after opening, with 00:00 meaning midnight", () => {
    expect(openingHoursSchema.safeParse({ useHours: true, ordersPaused: false, days: Array(7).fill(day(true, "09:00", "00:00")) }).success).toBe(true);
    expect(openingHoursSchema.safeParse({ useHours: true, ordersPaused: false, days: Array(7).fill(day(true, "22:00", "08:00")) }).success).toBe(false);
  });
  it("needs at least one open day when hours are on", () => {
    expect(openingHoursSchema.safeParse({ useHours: true, ordersPaused: false, days: Array(7).fill(day(false)) }).success).toBe(false);
    expect(openingHoursSchema.safeParse({ useHours: false, ordersPaused: true, days: Array(7).fill(day(false)) }).success).toBe(true);
  });
});
