import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CsvFormatError, groupByHandle, parseProductCsv, templateCsv, validateGroup } from "@/lib/catalogue/csv";

const categories = new Map([["rice-grains", randomUUID()]]);
const csv = (s: string) => Buffer.from(s.trim() + "\n");

describe("parseProductCsv", () => {
  it("reads the template back and groups variants by handle", () => {
    const rows = parseProductCsv(Buffer.from(templateCsv()));
    const groups = groupByHandle(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows.map((r) => r.sku)).toEqual(["OFADA-5", "OFADA-10"]);
    expect(groups[0]!.firstLine).toBe(2);
  });

  it("accepts a byte-order mark and header case and spacing", () => {
    const rows = parseProductCsv(Buffer.from("﻿ Handle ,TITLE,category,sku,price\nx,X,rice-grains,X-1,100"));
    expect(rows[0]!.handle).toBe("x");
    expect(rows[0]!.brand).toBe("");
  });

  it("names the missing required columns", () => {
    expect(() => parseProductCsv(csv("handle,title\nx,X"))).toThrow(/category, sku, price/);
    expect(() => parseProductCsv(csv("handle,title\nx,X"))).toThrow(CsvFormatError);
  });

  it("rejects an empty file", () => {
    expect(() => parseProductCsv(csv("handle,title,category,sku,price"))).toThrow(/no rows/);
  });
});

describe("validateGroup", () => {
  it("turns the template into a valid two-variant product", () => {
    const [group] = groupByHandle(parseProductCsv(Buffer.from(templateCsv())));
    const { parsed, errors } = validateGroup(group!, categories, []);
    expect(errors).toEqual([]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.options).toEqual([{ name: "Size", values: ["5kg", "10kg"] }]);
    expect(parsed.data.variants.map((v) => v.price)).toEqual([950_000n, 1_800_000n]);
    expect(parsed.data.variants[1]!.compareAtPrice).toBe(1_950_000n);
  });

  it("reports unknown categories and bad prices against their file line", () => {
    const rows = parseProductCsv(
      csv(`
handle,title,category,sku,price,option1_name,option1_value
mug,Mug,kitchenware,MUG-S,1500,Size,S
mug,Mug,kitchenware,MUG-L,lots,Size,L`),
    );
    const { errors } = validateGroup(groupByHandle(rows)[0]!, categories, []);
    expect(errors.some((e) => e.startsWith('category: "kitchenware"'))).toBe(true);
    expect(errors.some((e) => e.startsWith("line 3, price:"))).toBe(true);
  });

  it("escapes HTML in descriptions instead of trusting it", () => {
    const rows = parseProductCsv(csv(`handle,title,category,sku,price,description\nx,X,rice-grains,X-1,100,"<script>alert(1)</script>"`));
    const { input } = validateGroup(groupByHandle(rows)[0]!, categories, []);
    expect(input.descriptionHtml).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("rejects an unknown status rather than guessing", () => {
    const rows = parseProductCsv(csv(`handle,title,category,sku,price,status\nx,X,rice-grains,X-1,100,live`));
    const { errors } = validateGroup(groupByHandle(rows)[0]!, categories, []);
    expect(errors).toContain("status: use draft, active or archived");
  });
});
