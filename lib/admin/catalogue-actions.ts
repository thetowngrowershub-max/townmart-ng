"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminContext, AdminError, adminFailure } from "@/lib/admin/context";
import { slugify } from "@/lib/slug";
import {
  attributeSchema,
  categoryAttributesSchema,
  categorySchema,
  commissionRuleSchema,
  PLATFORM_SETTINGS,
  platformSettingsSchema,
  zoneSchema,
  type AttributeInput,
  type CategoryInput,
  type CommissionRuleInput,
  type ZoneInput,
} from "@/lib/validation/catalogue-admin";
import { zoneRatesSchema, type ZoneRatesInput } from "@/lib/validation/delivery-rates";
import { validationError, type ActionResult } from "@/lib/validation/form-result";

/**
 * The admin console's catalogue and fees screens: categories and their
 * attributes, commission rules, delivery zones and TownMart's default rates,
 * and platform settings. Every change is audited.
 */

const fail = (err: unknown) => adminFailure(err, "catalogue admin action");
const refresh = () => revalidatePath("/admin/catalogue", "layout");

// ─── Categories and attributes ──────────────────────────────────────────────

export async function saveCategoryAction(input: CategoryInput): Promise<ActionResult<{ id: string }>> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, parentId, ...d } = parsed.data;
  const data = { ...d, slug: d.slug || slugify(d.name), icon: d.icon || null, parentId };
  try {
    const { run } = await adminContext("catalogue.manage");
    const saved = await run(async (tx, audit) => {
      if (parentId) {
        if (parentId === id) throw new AdminError("A category can't be inside itself.");
        const parent = await tx.category.findUnique({ where: { id: parentId }, select: { kind: true, parentId: true } });
        if (!parent) throw new AdminError("Choose a parent from the list.");
        if (parent.parentId) throw new AdminError("Categories go two levels deep. Choose a top-level parent.");
        if (parent.kind !== data.kind) throw new AdminError(`The parent is a ${parent.kind} category. Choose one of the same kind.`);
        if (id && (await tx.category.count({ where: { parentId: id } }))) throw new AdminError("This category has subcategories, so it has to stay at the top level.");
      }
      if (id) {
        const before = await tx.category.findUnique({ where: { id }, select: { name: true, slug: true, kind: true, parentId: true, isActive: true, sortOrder: true } });
        if (!before) throw new AdminError("Category not found.");
        if (before.kind !== data.kind && (await tx.product.count({ where: { categoryId: id } })) + (await tx.service.count({ where: { categoryId: id } })) > 0) {
          throw new AdminError("Listings use this category, so its kind can't change.");
        }
        const c = await tx.category.update({ where: { id }, data, select: { id: true } });
        await audit("category.updated", "category", id, data, before);
        return c;
      }
      const c = await tx.category.create({ data, select: { id: true } });
      await audit("category.created", "category", c.id, data);
      return c;
    });
    refresh();
    revalidatePath("/", "layout");
    return { ok: true, data: saved, message: id ? "Category saved." : "Category created." };
  } catch (err) {
    return fail(err);
  }
}

export async function saveAttributeAction(input: AttributeInput): Promise<ActionResult<{ id: string }>> {
  const parsed = attributeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...d } = parsed.data;
  const data = { ...d, slug: d.slug || slugify(d.name).replace(/-/g, "_"), options: d.type === "select" ? d.options : [] };
  try {
    const { run } = await adminContext("catalogue.manage");
    const saved = await run(async (tx, audit) => {
      if (id) {
        const before = await tx.attribute.findUnique({ where: { id }, select: { name: true, slug: true, type: true, options: true } });
        if (!before) throw new AdminError("Attribute not found.");
        // Listings store values under the slug, so renaming the slug would orphan them.
        if (before.slug !== data.slug) throw new AdminError("The key can't change once an attribute exists. Create a new attribute instead.");
        const a = await tx.attribute.update({ where: { id }, data, select: { id: true } });
        await audit("attribute.updated", "attribute", id, data, before);
        return a;
      }
      const a = await tx.attribute.create({ data, select: { id: true } });
      await audit("attribute.created", "attribute", a.id, data);
      return a;
    });
    refresh();
    return { ok: true, data: saved, message: id ? "Attribute saved." : "Attribute created." };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteAttributeAction(input: { id: string }): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { run } = await adminContext("catalogue.manage");
    await run(async (tx, audit) => {
      const a = await tx.attribute.findUnique({ where: { id: parsed.data.id }, select: { name: true, slug: true, _count: { select: { categories: true } } } });
      if (!a) throw new AdminError("Attribute not found.");
      if (a._count.categories) throw new AdminError(`Remove it from ${a._count.categories} categor${a._count.categories === 1 ? "y" : "ies"} first.`);
      await tx.attribute.delete({ where: { id: parsed.data.id } });
      await audit("attribute.deleted", "attribute", parsed.data.id, null, { name: a.name, slug: a.slug });
    });
    refresh();
    return { ok: true, message: "Attribute deleted." };
  } catch (err) {
    return fail(err);
  }
}

/** Replaces a category's attributes; the list order is the order sellers see. */
export async function saveCategoryAttributesAction(input: z.input<typeof categoryAttributesSchema>): Promise<ActionResult> {
  const parsed = categoryAttributesSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { categoryId, items } = parsed.data;
  try {
    const { run } = await adminContext("catalogue.manage");
    await run(async (tx, audit) => {
      const before = await tx.categoryAttribute.findMany({ where: { categoryId }, orderBy: { sortOrder: "asc" }, select: { attributeId: true, isRequired: true } });
      if ((await tx.category.count({ where: { id: categoryId } })) === 0) throw new AdminError("Category not found.");
      if (items.length && (await tx.attribute.count({ where: { id: { in: items.map((i) => i.attributeId) } } })) !== items.length) throw new AdminError("Choose attributes from the list.");
      await tx.categoryAttribute.deleteMany({ where: { categoryId } });
      if (items.length) await tx.categoryAttribute.createMany({ data: items.map((i, n) => ({ categoryId, attributeId: i.attributeId, isRequired: i.isRequired, sortOrder: n })) });
      await audit("category.attributes_updated", "category", categoryId, items, before);
    });
    refresh();
    return { ok: true, message: "Attributes saved. Sellers see them when they edit listings in this category." };
  } catch (err) {
    return fail(err);
  }
}

// ─── Commission ─────────────────────────────────────────────────────────────

export async function addCommissionRuleAction(input: CommissionRuleInput): Promise<ActionResult> {
  const parsed = commissionRuleSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { scope, categoryId, businessId, percent, fixed, effectiveFrom } = parsed.data;
  try {
    const { actor, run } = await adminContext("settings.manage");
    await run(async (tx, audit) => {
      if (scope === "category" && !(await tx.category.count({ where: { id: categoryId! } }))) throw new AdminError("Choose a category from the list.");
      if (scope === "business" && !(await tx.business.count({ where: { id: businessId! } }))) throw new AdminError("Choose a seller from the list.");
      const rule = await tx.commissionRule.create({
        data: {
          scope,
          categoryId: scope === "category" ? categoryId : null,
          businessId: scope === "business" ? businessId : null,
          percentBps: percent,
          fixedKobo: fixed,
          effectiveFrom: effectiveFrom ?? new Date(),
          createdBy: actor.id,
        },
        select: { id: true },
      });
      await audit("commission.rule_added", "commission_rule", rule.id, { scope, categoryId, businessId, percentBps: percent, fixedKobo: fixed.toString(), effectiveFrom });
    });
    refresh();
    return { ok: true, message: effectiveFrom ? "Rule scheduled. Orders placed from then on use it." : "Rule added. New orders use it from now." };
  } catch (err) {
    return fail(err);
  }
}

/** Removes a rule so the next level applies to new orders. Past orders keep the commission they were charged. */
export async function deleteCommissionRuleAction(input: { id: string }): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { run } = await adminContext("settings.manage");
    await run(async (tx, audit) => {
      const r = await tx.commissionRule.findUnique({ where: { id: parsed.data.id } });
      if (!r) throw new AdminError("Rule not found.");
      await tx.commissionRule.delete({ where: { id: r.id } });
      await audit("commission.rule_removed", "commission_rule", r.id, null, { ...r, fixedKobo: r.fixedKobo.toString() });
    });
    refresh();
    return { ok: true, message: "Rule removed. New orders use the next rule that applies." };
  } catch (err) {
    return fail(err);
  }
}

// ─── Delivery ───────────────────────────────────────────────────────────────

export async function saveZoneAction(input: ZoneInput): Promise<ActionResult<{ id: string }>> {
  const parsed = zoneSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...d } = parsed.data;
  const data = { ...d, stateIds: [...new Set(d.stateIds)].sort((a, b) => a - b) };
  try {
    const { run } = await adminContext("settings.manage");
    const saved = await run(async (tx, audit) => {
      if ((await tx.state.count({ where: { id: { in: data.stateIds } } })) !== data.stateIds.length) throw new AdminError("Choose states from the list.");
      if (id) {
        const before = await tx.deliveryZone.findUnique({ where: { id }, select: { name: true, stateIds: true, priority: true, isActive: true } });
        if (!before) throw new AdminError("Zone not found.");
        const z = await tx.deliveryZone.update({ where: { id }, data, select: { id: true } });
        await audit("delivery_zone.updated", "delivery_zone", id, data, before);
        return z;
      }
      const z = await tx.deliveryZone.create({ data: { ...data, slug: slugify(data.name) }, select: { id: true } });
      await audit("delivery_zone.created", "delivery_zone", z.id, data);
      return z;
    });
    refresh();
    return { ok: true, data: saved, message: id ? "Zone saved." : "Zone created. Add TownMart's rates for it next." };
  } catch (err) {
    return fail(err);
  }
}

/** Replaces TownMart's default bands for a zone. Sellers with their own bands keep them. */
export async function savePlatformRatesAction(input: ZoneRatesInput): Promise<ActionResult> {
  const parsed = zoneRatesSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { zoneId, bands } = parsed.data;
  try {
    const { run } = await adminContext("settings.manage");
    await run(async (tx, audit) => {
      const before = await tx.deliveryRate.findMany({ where: { zoneId, businessId: null }, orderBy: { minWeightG: "asc" } });
      if (!(await tx.deliveryZone.count({ where: { id: zoneId } }))) throw new AdminError("Zone not found.");
      await tx.deliveryRate.deleteMany({ where: { zoneId, businessId: null } });
      let from = 0;
      for (const b of bands) {
        await tx.deliveryRate.create({ data: { zoneId, businessId: null, minWeightG: from, maxWeightG: b.upToKg, feeKobo: b.fee, freeOverKobo: b.freeOver, etaDaysMin: b.etaMin, etaDaysMax: b.etaMax } });
        from = b.upToKg ?? from;
      }
      const show = (r: { minWeightG: number; maxWeightG: number | null; feeKobo: bigint }) => ({ from: r.minWeightG, to: r.maxWeightG, fee: r.feeKobo.toString() });
      await audit("delivery_rates.updated", "delivery_zone", zoneId, bands.map((b) => ({ to: b.upToKg, fee: b.fee.toString() })), before.map(show));
    });
    refresh();
    return { ok: true, message: "TownMart's rates for this zone are saved. Checkout uses them from now on." };
  } catch (err) {
    return fail(err);
  }
}

// ─── Platform settings ──────────────────────────────────────────────────────

export async function savePlatformSettingsAction(input: Record<string, string | boolean>): Promise<ActionResult> {
  const parsed = platformSettingsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { actor, run } = await adminContext("settings.manage");
    const changed = await run(async (tx, audit) => {
      const keys = PLATFORM_SETTINGS.map((s) => s.key as string);
      const rows = await tx.setting.findMany({ where: { key: { in: keys } } });
      const current = new Map(rows.map((r) => [r.key, r.value]));
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const s of PLATFORM_SETTINGS) {
        const value = parsed.data[s.key];
        if (value === undefined || current.get(s.key) === value) continue;
        before[s.key] = current.get(s.key) ?? null;
        after[s.key] = value;
        await tx.setting.upsert({ where: { key: s.key }, create: { key: s.key, value, description: s.label, updatedBy: actor.id }, update: { value, updatedBy: actor.id } });
      }
      const n = Object.keys(after).length;
      if (n) await audit("settings.updated", "setting", null, after, before);
      return n;
    });
    refresh();
    return { ok: true, message: changed ? `Saved ${changed} change${changed === 1 ? "" : "s"}. New orders, bookings and payouts use them from now.` : "Nothing changed." };
  } catch (err) {
    return fail(err);
  }
}
