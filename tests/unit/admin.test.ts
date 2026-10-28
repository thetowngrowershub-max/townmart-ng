import { describe, expect, it } from "vitest";
import { change, lagosDayStart, parseRange, periods, refundRateBps } from "@/lib/analytics/metrics";
import { checkAttributes, type AttributeDef } from "@/lib/catalogue/attributes";
import { csvCell, csvRows } from "@/lib/csv";
import { matchKeywords, parseKeywords } from "@/lib/moderation/keywords";
import { sanitizeCmsHtml, sanitizeRichText } from "@/lib/sanitize";
import { cleanFlags } from "@/lib/staff/flags";
import { commissionRuleSchema, platformSettingsSchema } from "@/lib/validation/catalogue-admin";
import { bannerSchema } from "@/lib/validation/cms";

/** Phase 7 pure logic: analytics periods, CSV safety, keyword matching, attributes, admin form rules, CMS HTML. */

describe("analytics periods", () => {
  it("starts days at midnight Lagos time", () => {
    // 23:30 UTC on 1 Nov is 00:30 on 2 Nov in Lagos.
    expect(lagosDayStart(new Date("2026-11-01T23:30:00Z"), 0).toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(lagosDayStart(new Date("2026-11-01T22:30:00Z"), 0).toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(lagosDayStart(new Date("2026-11-01T12:00:00Z"), 6).toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("compares a period with the same length before it", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const { current, previous } = periods(7, now);
    expect(current.to).toBe(now);
    expect(previous.to).toEqual(current.from);
    expect(current.from.getTime() - previous.from.getTime()).toBe(7 * 86_400_000);
  });

  it("only accepts the offered ranges", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("90")).toBe(90);
    expect(parseRange("365")).toBe(30);
    expect(parseRange(undefined)).toBe(30);
  });

  it("reports change and refund rate safely", () => {
    expect(change(150, 100)).toBe(50);
    expect(change(50, 100)).toBe(-50);
    expect(change(10, 0)).toBeNull();
    expect(refundRateBps(2_500n, 100_000n)).toBe(250);
    expect(refundRateBps(1n, 0n)).toBe(0);
  });
});

describe("CSV cells", () => {
  it("neutralises formulas but keeps numbers", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+2348031234567")).toBe("'+2348031234567");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell("-1500")).toBe("-1500");
    expect(csvCell("Ikeja, Lagos")).toBe('"Ikeja, Lagos"');
    expect(csvRows([["a", "b"]])).toBe("a,b\r\n");
  });
});

describe("prohibited-items keywords", () => {
  it("normalises the admin's list", () => {
    expect(parseKeywords("Tramadol\n codeine syrup ,tramadol\nab\n")).toEqual(["codeine syrup", "tramadol"]);
  });

  it("matches whole words and simple plurals in any listing text", () => {
    const k = ["tramadol", "codeine syrup", "gun"];
    expect(matchKeywords({ title: "Tramadol 100mg" }, k)).toEqual(["tramadol"]);
    expect(matchKeywords({ title: "Cough remedy", descriptionHtml: "<p>Contains <b>codeine</b>  syrup</p>" }, k)).toEqual(["codeine syrup"]);
    expect(matchKeywords({ title: "Toy water guns" }, k)).toEqual(["gun"]);
    expect(matchKeywords({ title: "Burgundy dress", tags: ["begun"] }, k)).toEqual([]);
  });
});

describe("category attributes", () => {
  const defs: AttributeDef[] = [
    { slug: "condition", name: "Condition", type: "select", options: ["Brand new", "UK used"], isRequired: true },
    { slug: "screen", name: "Screen size", type: "number", options: [], isRequired: false },
    { slug: "material", name: "Material", type: "text", options: [], isRequired: false },
  ];

  it("keeps known values, numbers as numbers", () => {
    expect(checkAttributes(defs, { condition: "UK used", screen: "6.5", material: " Cotton ", stray: "x" })).toEqual({ ok: true, value: { condition: "UK used", screen: 6.5, material: "Cotton" } });
  });

  it("refuses a missing required value, a non-number and an option not on the list", () => {
    expect(checkAttributes(defs, {})).toEqual({ ok: false, errors: { condition: "Enter condition" } });
    const r = checkAttributes(defs, { condition: "Fake", screen: "big" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toEqual({ condition: "Choose from the list", screen: "Enter a number" });
  });
});

describe("admin forms", () => {
  it("commission rules need a target and a sane rate, starting now or later", () => {
    expect(commissionRuleSchema.safeParse({ scope: "global", categoryId: "", businessId: "", percent: "7.5", fixed: "", effectiveFrom: "" }).data).toMatchObject({ percent: 750, fixed: 0n, effectiveFrom: null });
    expect(commissionRuleSchema.safeParse({ scope: "category", categoryId: "", businessId: "", percent: "5", fixed: "", effectiveFrom: "" }).success).toBe(false);
    expect(commissionRuleSchema.safeParse({ scope: "global", categoryId: "", businessId: "", percent: "60", fixed: "", effectiveFrom: "" }).success).toBe(false);
    expect(commissionRuleSchema.safeParse({ scope: "global", categoryId: "", businessId: "", percent: "5", fixed: "", effectiveFrom: "2020-01-01T10:00" }).success).toBe(false);
  });

  it("platform settings are range-checked in the units admins use", () => {
    const ok = platformSettingsSchema.safeParse({ "fees.service_fee_percent": "1.5", "payouts.minimum_naira": "1,000", "payments.pay_on_delivery_enabled": false });
    expect(ok.success).toBe(false); // the other numeric settings are missing
    const all = {
      "fees.service_fee_percent": "1.5",
      "fees.service_fee_cap_naira": "1000",
      "fees.vat_percent": "7.5",
      "commission.default_percent": "5",
      "checkout.stock_hold_minutes": "15",
      "payments.pay_on_delivery_enabled": true,
      "orders.auto_complete_days": "7",
      "refunds.seller_response_hours": "48",
      "refunds.late_cancel_percent": "50",
      "escrow.release_days": "3",
      "payouts.minimum_naira": "1,000",
      "bookings.lead_minutes": "120",
      "bookings.days_ahead": "60",
    };
    expect(platformSettingsSchema.parse(all)).toMatchObject({ "fees.service_fee_percent": 1.5, "payouts.minimum_naira": 1000, "payments.pay_on_delivery_enabled": true });
    expect(platformSettingsSchema.safeParse({ ...all, "refunds.late_cancel_percent": "150" }).success).toBe(false);
    expect(platformSettingsSchema.safeParse({ ...all, "checkout.stock_hold_minutes": "1" }).success).toBe(false);
  });

  it("banner links stay on TownMart or use https", () => {
    const base = { title: "Sale", sortOrder: "0", isActive: true };
    expect(bannerSchema.safeParse({ ...base, linkUrl: "/deals" }).success).toBe(true);
    expect(bannerSchema.safeParse({ ...base, linkUrl: "https://example.ng/x" }).success).toBe(true);
    for (const bad of ["//evil.example", "/\\evil.example", "javascript:alert(1)", "http://example.ng"]) {
      expect(bannerSchema.safeParse({ ...base, linkUrl: bad }).success).toBe(false);
    }
    expect(bannerSchema.safeParse({ ...base, ctaLabel: "Go" }).success).toBe(false);
    expect(bannerSchema.safeParse({ ...base, imageKey: "products/abc/x.webp" }).success).toBe(false);
  });

  it("staff flags keep only known areas that are on", () => {
    expect(cleanFlags({ orders: true, inventory: false, payouts: true, reviews: "yes" })).toEqual({ orders: true });
  });
});

describe("CMS HTML", () => {
  it("allows links to TownMart paths in CMS content only", () => {
    const html = '<p><a href="/sell">Sell</a> <a href="//evil.example">x</a> <a href="/\\evil.example">y</a> <a href="javascript:alert(1)">z</a> <a href="https://paystack.com">p</a></p>';
    const cms = sanitizeCmsHtml(html);
    expect(cms).toContain('<a href="/sell">Sell</a>');
    expect(cms).not.toContain("evil.example");
    expect(cms).not.toContain("javascript");
    expect(cms).toContain('href="https://paystack.com" rel="nofollow noopener noreferrer" target="_blank"');
    expect(sanitizeRichText('<a href="/sell">Sell</a>')).not.toContain('href="/sell"');
  });
});
