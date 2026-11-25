"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminContext, AdminError, adminFailure } from "@/lib/admin/context";
import { sanitizeCmsHtml } from "@/lib/sanitize";
import { bannerSchema, cmsPageSchema, faqSchema, featuredStoresSchema, type BannerInput, type CmsPageInput, type FaqInput } from "@/lib/validation/cms";
import { validationError, type ActionResult } from "@/lib/validation/form-result";

/**
 * Content TownMart edits from the admin console: homepage banners and
 * featured stores, help centre questions, and the about and contact pages.
 * HTML is sanitised with the same allowlist as listing descriptions.
 */

const fail = (err: unknown) => adminFailure(err, "content action");
const idSchema = z.object({ id: z.uuid() });

function refresh(...paths: string[]) {
  revalidatePath("/admin/content", "layout");
  for (const p of paths) revalidatePath(p);
}

export async function saveBannerAction(input: BannerInput): Promise<ActionResult<{ id: string }>> {
  const parsed = bannerSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...d } = parsed.data;
  const data = { ...d, subtitle: d.subtitle || null, imageKey: d.imageKey || null, linkUrl: d.linkUrl || null, ctaLabel: d.ctaLabel || null };
  try {
    const { actor, run } = await adminContext("content.manage");
    const saved = await run(async (tx, audit) => {
      if (id) {
        const before = await tx.cmsBanner.findUnique({ where: { id } });
        if (!before) throw new AdminError("Banner not found.");
        const b = await tx.cmsBanner.update({ where: { id }, data: { ...data, updatedBy: actor.id }, select: { id: true } });
        await audit("cms.banner_updated", "cms_banner", id, data, before);
        return b;
      }
      const b = await tx.cmsBanner.create({ data: { ...data, updatedBy: actor.id }, select: { id: true } });
      await audit("cms.banner_created", "cms_banner", b.id, data);
      return b;
    });
    refresh("/");
    return { ok: true, data: saved, message: "Banner saved." };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteBannerAction(input: { id: string }): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { run } = await adminContext("content.manage");
    await run(async (tx, audit) => {
      const before = await tx.cmsBanner.findUnique({ where: { id: parsed.data.id } });
      if (!before) throw new AdminError("Banner not found.");
      await tx.cmsBanner.delete({ where: { id: before.id } });
      await audit("cms.banner_deleted", "cms_banner", before.id, null, before);
    });
    refresh("/");
    return { ok: true, message: "Banner deleted." };
  } catch (err) {
    return fail(err);
  }
}

/** Replaces the featured list; its order is the homepage order. Only approved stores can be featured. */
export async function saveFeaturedStoresAction(input: z.input<typeof featuredStoresSchema>): Promise<ActionResult> {
  const parsed = featuredStoresSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const ids = [...new Set(parsed.data.businessIds)];
  try {
    const { run } = await adminContext("content.manage");
    await run(async (tx, audit) => {
      if (ids.length && (await tx.business.count({ where: { id: { in: ids }, status: "approved" } })) !== ids.length) throw new AdminError("Only approved stores can be featured.");
      const before = await tx.featuredStore.findMany({ orderBy: { sortOrder: "asc" }, select: { businessId: true } });
      await tx.featuredStore.deleteMany({});
      if (ids.length) await tx.featuredStore.createMany({ data: ids.map((businessId, sortOrder) => ({ businessId, sortOrder })) });
      await audit("cms.featured_stores_updated", "featured_store", null, ids, before.map((b) => b.businessId));
    });
    refresh("/");
    return { ok: true, message: ids.length ? `${ids.length} store${ids.length === 1 ? "" : "s"} featured on the homepage.` : "No stores featured." };
  } catch (err) {
    return fail(err);
  }
}

export async function saveFaqAction(input: FaqInput): Promise<ActionResult<{ id: string }>> {
  const parsed = faqSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...d } = parsed.data;
  const data = { ...d, answerHtml: sanitizeCmsHtml(d.answerHtml) };
  try {
    const { actor, run } = await adminContext("content.manage");
    const saved = await run(async (tx, audit) => {
      if (id) {
        const before = await tx.faqEntry.findUnique({ where: { id }, select: { section: true, question: true, isPublished: true } });
        if (!before) throw new AdminError("Question not found.");
        const f = await tx.faqEntry.update({ where: { id }, data: { ...data, updatedBy: actor.id }, select: { id: true } });
        await audit("cms.faq_updated", "faq_entry", id, { section: data.section, question: data.question, isPublished: data.isPublished }, before);
        return f;
      }
      const f = await tx.faqEntry.create({ data: { ...data, updatedBy: actor.id }, select: { id: true } });
      await audit("cms.faq_created", "faq_entry", f.id, { section: data.section, question: data.question });
      return f;
    });
    refresh("/help");
    return { ok: true, data: saved, message: "Saved." };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteFaqAction(input: { id: string }): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { run } = await adminContext("content.manage");
    await run(async (tx, audit) => {
      const before = await tx.faqEntry.findUnique({ where: { id: parsed.data.id }, select: { id: true, section: true, question: true } });
      if (!before) throw new AdminError("Question not found.");
      await tx.faqEntry.delete({ where: { id: before.id } });
      await audit("cms.faq_deleted", "faq_entry", before.id, null, before);
    });
    refresh("/help");
    return { ok: true, message: "Question deleted." };
  } catch (err) {
    return fail(err);
  }
}

export async function saveCmsPageAction(input: CmsPageInput): Promise<ActionResult> {
  const parsed = cmsPageSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { slug, ...d } = parsed.data;
  const data = { ...d, summary: d.summary || null, bodyHtml: sanitizeCmsHtml(d.bodyHtml) };
  try {
    const { actor, run } = await adminContext("content.manage");
    await run(async (tx, audit) => {
      const before = await tx.cmsPage.findUnique({ where: { slug }, select: { title: true, updatedAt: true } });
      await tx.cmsPage.upsert({ where: { slug }, create: { slug, ...data, updatedBy: actor.id }, update: { ...data, updatedBy: actor.id } });
      await audit("cms.page_updated", "cms_page", slug, { title: data.title }, before);
    });
    refresh(`/${slug}`);
    return { ok: true, message: "Page saved." };
  } catch (err) {
    return fail(err);
  }
}
