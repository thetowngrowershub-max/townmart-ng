import type { Tx } from "@/lib/db";

/** An attribute a category asks sellers to fill in, in display order. */
export type AttributeDef = { slug: string; name: string; type: "text" | "number" | "select"; options: string[]; isRequired: boolean };

/**
 * A category's attributes: its parent's first, then its own. A subcategory
 * inherits what its parent asks for; when both list one, the stricter
 * "required" wins.
 */
export async function categoryAttributeDefs(tx: Tx, categoryIds: readonly string[]): Promise<Map<string, AttributeDef[]>> {
  const categories = await tx.category.findMany({ where: { id: { in: [...categoryIds] } }, select: { id: true, parentId: true } });
  const ids = [...new Set(categories.flatMap((c) => [c.id, ...(c.parentId ? [c.parentId] : [])]))];
  const rows = await tx.categoryAttribute.findMany({
    where: { categoryId: { in: ids } },
    orderBy: { sortOrder: "asc" },
    select: { categoryId: true, isRequired: true, attribute: { select: { slug: true, name: true, type: true, options: true } } },
  });
  const own = (id: string) => rows.filter((r) => r.categoryId === id);
  const out = new Map<string, AttributeDef[]>();
  for (const c of categories) {
    const defs = new Map<string, AttributeDef>();
    for (const r of [...(c.parentId ? own(c.parentId) : []), ...own(c.id)]) {
      const prev = defs.get(r.attribute.slug);
      defs.set(r.attribute.slug, { ...r.attribute, isRequired: r.isRequired || (prev?.isRequired ?? false) });
    }
    out.set(c.id, [...defs.values()]);
  }
  return out;
}

/**
 * Checks a listing's attribute values against its category: required ones
 * present, numbers numeric, list values from the list. Returns what to store
 * (only known attributes, numbers as numbers) or the first problem per field.
 */
export function checkAttributes(defs: readonly AttributeDef[], values: Readonly<Record<string, string>>): { ok: true; value: Record<string, string | number> } | { ok: false; errors: Record<string, string> } {
  const value: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  for (const d of defs) {
    const v = (values[d.slug] ?? "").trim();
    if (!v) {
      if (d.isRequired) errors[d.slug] = `Enter ${d.name.toLowerCase()}`;
      continue;
    }
    if (d.type === "number") {
      const n = Number(v.replace(/,/g, ""));
      if (!Number.isFinite(n)) errors[d.slug] = "Enter a number";
      else value[d.slug] = n;
    } else if (d.type === "select") {
      if (!d.options.includes(v)) errors[d.slug] = "Choose from the list";
      else value[d.slug] = v;
    } else value[d.slug] = v;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}
