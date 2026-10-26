import type { Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { koboToNairaString } from "@/lib/money";
import { productInputSchema, type ProductInput } from "@/lib/validation/catalogue";

/**
 * Product CSV: one row per variant. Rows with the same `handle` belong to one
 * product; product-level columns are read from the first row of each handle.
 * Import matches existing variants by SKU (unique per business), so exporting,
 * editing and re-importing a file updates in place. Images are managed in the
 * dashboard, not by CSV.
 */
export const CSV_COLUMNS = [
  "handle",
  "title",
  "category",
  "description",
  "brand",
  "tags",
  "unit",
  "min_order_qty",
  "allow_fractional_qty",
  "track_inventory",
  "allow_backorder",
  "is_perishable",
  "shelf_life_note",
  "weight_grams",
  "status",
  "option1_name",
  "option1_value",
  "option2_name",
  "option2_value",
  "option3_name",
  "option3_value",
  "sku",
  "barcode",
  "price",
  "compare_at_price",
  "cost_price",
  "stock_qty",
  "low_stock_threshold",
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];
export type CsvRow = Record<CsvColumn, string>;

export const MAX_IMPORT_ROWS = 5000;

export type RowIssue = { row: number; handle: string; messages: string[] };
export type ImportReport = { errors: RowIssue[]; warnings: RowIssue[] };

export class CsvFormatError extends Error {}

/** Parses and checks the header. Row numbers in reports are 1-based file lines (header = 1). */
export function parseProductCsv(buf: Buffer): CsvRow[] {
  let records: Record<string, string>[];
  try {
    records = parse(buf, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  } catch (err) {
    throw new CsvFormatError(`The file isn't valid CSV: ${err instanceof Error ? err.message : "parse error"}`);
  }
  const first = records[0];
  if (!first) throw new CsvFormatError("The file has no rows.");
  const missing = (["handle", "title", "category", "sku", "price"] as const).filter((c) => !(c in first));
  if (missing.length) throw new CsvFormatError(`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template to see the format.`);
  if (records.length > MAX_IMPORT_ROWS) throw new CsvFormatError(`Too many rows (${records.length}). Split the file into parts of ${MAX_IMPORT_ROWS} rows or fewer.`);
  return records.map((r) => Object.fromEntries(CSV_COLUMNS.map((c) => [c, (r[c] ?? "").toString()])) as CsvRow);
}

export type ProductGroup = { handle: string; firstLine: number; rows: CsvRow[] };

export function groupByHandle(rows: CsvRow[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  rows.forEach((row, i) => {
    const handle = row.handle.trim().toLowerCase() || `__row${i}`;
    const g = groups.get(handle) ?? { handle, firstLine: i + 2, rows: [] };
    g.rows.push(row);
    groups.set(handle, g);
  });
  return [...groups.values()];
}

const bool = (v: string, fallback: boolean) => {
  const s = v.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return fallback;
};
const opt = (v: string) => (v.trim() === "" ? undefined : v.trim());

/** Reads product-level fields and variants from a group; images and ids are filled in by the importer. */
export function groupToProductInput(
  g: ProductGroup,
  categoryIdBySlug: ReadonlyMap<string, string>,
): { input: Omit<ProductInput, "images">; errors: string[] } {
  const head = g.rows[0]!;
  const errors: string[] = [];
  const categoryId = categoryIdBySlug.get(head.category.trim().toLowerCase());
  if (!categoryId) errors.push(`category: "${head.category}" isn't a product category slug (see the template's notes)`);

  const optionNames = ([1, 2, 3] as const).map((n) => head[`option${n}_name`].trim()).filter(Boolean);
  const valuesByOption = new Map(optionNames.map((n) => [n, new Set<string>()]));
  const variants = g.rows.map((r) => {
    const optionValues: Record<string, string> = {};
    ([1, 2, 3] as const).forEach((n) => {
      const name = head[`option${n}_name`].trim();
      const value = r[`option${n}_value`].trim();
      if (name && value) {
        optionValues[name] = value;
        valuesByOption.get(name)!.add(value);
      }
    });
    return {
      sku: r.sku.trim(),
      barcode: opt(r.barcode),
      optionValues,
      price: r.price.trim(),
      compareAtPrice: opt(r.compare_at_price),
      stockQty: opt(r.stock_qty) ?? "0",
      lowStockThreshold: opt(r.low_stock_threshold) ?? "5",
    };
  });

  const status = (opt(head.status) ?? "draft").toLowerCase();
  const input: Omit<ProductInput, "images"> = {
    title: head.title.trim(),
    descriptionHtml: head.description.trim() ? `<p>${escapeHtml(head.description.trim()).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</p>` : "",
    categoryId: categoryId ?? "",
    brand: opt(head.brand),
    tags: head.tags.replace(/;/g, ","),
    unit: (opt(head.unit) ?? "piece").toLowerCase() as ProductInput["unit"],
    minOrderQty: opt(head.min_order_qty) ?? "1",
    allowFractionalQty: bool(head.allow_fractional_qty, false),
    trackInventory: bool(head.track_inventory, true),
    allowBackorder: bool(head.allow_backorder, false),
    weightGrams: opt(head.weight_grams) as unknown as number | undefined,
    isPerishable: bool(head.is_perishable, false),
    shelfLifeNote: opt(head.shelf_life_note),
    costPrice: opt(head.cost_price),
    status: (["draft", "active", "archived"].includes(status) ? status : "draft") as ProductInput["status"],
    options: optionNames.map((name) => ({ name, values: [...valuesByOption.get(name)!].join(",") })),
    variants,
  };
  if (!["draft", "active", "archived"].includes(status)) errors.push(`status: use draft, active or archived`);
  return { input, errors };
}

const COLUMN_FOR_FIELD: Record<string, string> = {
  title: "title",
  categoryId: "category",
  unit: "unit",
  minOrderQty: "min_order_qty",
  allowFractionalQty: "allow_fractional_qty",
  weightGrams: "weight_grams",
  costPrice: "cost_price",
  tags: "tags",
  brand: "brand",
  options: "option names",
  sku: "sku",
  price: "price",
  compareAtPrice: "compare_at_price",
  stockQty: "stock_qty",
  lowStockThreshold: "low_stock_threshold",
  optionValues: "option values",
  barcode: "barcode",
};

/** Turns schema issues into CSV-friendly messages ("line 4, price: …"). */
export function describeIssues(g: ProductGroup, issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((i) => {
    const [first, index, field] = i.path;
    if (first === "variants" && typeof index === "number") {
      const col = COLUMN_FOR_FIELD[String(field ?? "")] ?? String(field ?? "variant");
      return `line ${g.firstLine + index}, ${col}: ${i.message}`;
    }
    return `${COLUMN_FOR_FIELD[String(first)] ?? String(first ?? "row")}: ${i.message}`;
  });
}

export function validateGroup(g: ProductGroup, categoryIdBySlug: ReadonlyMap<string, string>, images: ProductInput["images"]) {
  const { input, errors } = groupToProductInput(g, categoryIdBySlug);
  const parsed = productInputSchema.safeParse({ ...input, images });
  return { input, parsed, errors: [...errors, ...(parsed.success ? [] : describeIssues(g, parsed.error.issues))] };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ─── Export ─────────────────────────────────────────────────────────────────

export type ExportProduct = Prisma.ProductGetPayload<{
  include: { category: { select: { slug: true } }; options: true; variants: true };
}> & { descriptionText: string };

/** One row per variant, in the import format, so a file can be edited and re-imported. */
export function productsToCsv(products: ExportProduct[]): string {
  const rows: string[][] = [];
  for (const p of products) {
    const options = [...p.options].sort((a, b) => a.position - b.position);
    const variants = [...p.variants].sort((a, b) => a.position - b.position);
    for (const v of variants) {
      const ov = (v.optionValues ?? {}) as Record<string, string>;
      const row: Record<CsvColumn, string> = {
        handle: p.slug,
        title: p.title,
        category: p.category.slug,
        description: p.descriptionText,
        brand: p.brand ?? "",
        tags: p.tags.join(", "),
        unit: p.unit,
        min_order_qty: p.minOrderQty.toString(),
        allow_fractional_qty: String(p.allowFractionalQty),
        track_inventory: String(p.trackInventory),
        allow_backorder: String(p.allowBackorder),
        is_perishable: String(p.isPerishable),
        shelf_life_note: p.shelfLifeNote ?? "",
        weight_grams: p.weightGrams?.toString() ?? "",
        status: p.status,
        option1_name: options[0]?.name ?? "",
        option1_value: options[0] ? (ov[options[0].name] ?? "") : "",
        option2_name: options[1]?.name ?? "",
        option2_value: options[1] ? (ov[options[1].name] ?? "") : "",
        option3_name: options[2]?.name ?? "",
        option3_value: options[2] ? (ov[options[2].name] ?? "") : "",
        sku: v.sku,
        barcode: v.barcode ?? "",
        price: koboToNairaString(v.priceKobo),
        compare_at_price: v.compareAtPriceKobo !== null ? koboToNairaString(v.compareAtPriceKobo) : "",
        cost_price: p.costPriceKobo !== null ? koboToNairaString(p.costPriceKobo) : "",
        stock_qty: v.stockQty.toString(),
        low_stock_threshold: v.lowStockThreshold.toString(),
      };
      rows.push(CSV_COLUMNS.map((c) => row[c]));
    }
  }
  return stringify(rows, { header: true, columns: [...CSV_COLUMNS] });
}

export function templateCsv(): string {
  const sample: Partial<Record<CsvColumn, string>>[] = [
    { handle: "ofada-rice-5kg", title: "Ofada rice", category: "rice-grains", description: "Locally grown, stone-free.", brand: "Abeokuta Farms", tags: "rice, local", unit: "bag", min_order_qty: "1", track_inventory: "true", status: "draft", option1_name: "Size", option1_value: "5kg", sku: "OFADA-5", price: "9500", stock_qty: "40", low_stock_threshold: "5" },
    { handle: "ofada-rice-5kg", option1_value: "10kg", sku: "OFADA-10", price: "18000", compare_at_price: "19500", stock_qty: "15", low_stock_threshold: "3" },
  ];
  return stringify(
    sample.map((r) => CSV_COLUMNS.map((c) => r[c] ?? "")),
    { header: true, columns: [...CSV_COLUMNS] },
  );
}
