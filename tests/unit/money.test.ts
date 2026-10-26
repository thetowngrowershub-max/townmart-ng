import { describe, expect, it } from "vitest";
import { formatNaira, parseNairaToKobo } from "@/lib/money";

describe("formatNaira", () => {
  it.each([
    [0n, "₦0.00"],
    [5n, "₦0.05"],
    [1_250_000n, "₦12,500.00"],
    [123_456_789n, "₦1,234,567.89"],
    [-50_000n, "-₦500.00"],
  ])("%s kobo → %s", (kobo, expected) => {
    expect(formatNaira(kobo)).toBe(expected);
  });

  it("stays exact beyond Number.MAX_SAFE_INTEGER", () => {
    expect(formatNaira(900_719_925_474_099_312n)).toBe("₦9,007,199,254,740,993.12");
  });
});

describe("parseNairaToKobo", () => {
  it.each([
    ["12500", 1_250_000n],
    ["12,500.5", 1_250_050n],
    ["₦1,000.00", 100_000n],
    ["0.07", 7n],
  ])("%s → %s kobo", (input, kobo) => {
    expect(parseNairaToKobo(input)).toBe(kobo);
  });

  it.each(["", "abc", "-5", "1.234", "1e3"])("rejects %j", (input) => {
    expect(() => parseNairaToKobo(input)).toThrow();
  });
});
