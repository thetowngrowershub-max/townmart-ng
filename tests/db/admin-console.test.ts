import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { dashboard } from "@/lib/analytics/metrics";
import { categoryAttributeDefs } from "@/lib/catalogue/attributes";
import { CatalogueError, saveProduct } from "@/lib/catalogue/products";
import { prisma, withRls, withSystemContext } from "@/lib/db";
import { restoreListing, screenListing, takeDownListing } from "@/lib/moderation/core";
import type { ProductData } from "@/lib/validation/catalogue";
import { createUser, deleteUsers, lagosIkeja, owner } from "./helpers";

/**
 * Phase 7 at the database layer: take-downs (only TownMart, hidden from
 * shoppers and checkout searches), listing reports and questions, staff
 * invitations kept to their shop, CMS content visibility, the append-only
 * ops log, admin-only reference data, category attributes and the
 * analytics totals.
 */

const tag = randomUUID().slice(0, 8);
const users: string[] = [];
const businesses: string[] = [];
const categories: string[] = [];
const attributes: string[] = [];
const cms: { banners: string[]; faqs: string[] } = { banners: [], faqs: [] };

function asSystem<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
    return fn(tx);
  });
}

async function user(label: string) {
  const u = await createUser(`${label}-${tag}`);
  users.push(u.id);
  return u;
}

async function shop(label: string, productTitle = `${label} item ${tag}`) {
  const ownerUser = await user(label);
  const { stateId, lgaId } = await lagosIkeja();
  const categoryId = (await owner.category.findFirstOrThrow({ where: { kind: "product", isActive: true, parentId: { not: null } } })).id;
  return asSystem(async (tx) => {
    const business = await tx.business.create({
      data: {
        ownerUserId: ownerUser.id,
        type: "merchant",
        name: `${label} ${tag}`,
        slug: `${label}-${tag}`,
        email: `${label}-${tag}@test.townmart.local`,
        phoneEncrypted: "v1.k1.test.test.test",
        phoneHash: `${label}-${tag}`,
        addressEncrypted: "v1.k1.test.test.test",
        city: "Ikeja",
        stateId,
        lgaId,
        status: "approved",
      },
    });
    businesses.push(business.id);
    const product = await tx.product.create({ data: { businessId: business.id, categoryId, title: productTitle, slug: `${label}-item-${tag}`, basePriceKobo: 100_000n, status: "active" } });
    return { userId: ownerUser.id, businessId: business.id, productId: product.id, ctx: { userId: ownerUser.id, businessId: business.id } };
  });
}

const admin = async () => ({ scope: "admin" as const, userId: (await user("admin")).id });

afterAll(async () => {
  await asSystem(async (tx) => {
    await tx.listingReport.deleteMany({ where: { businessId: { in: businesses } } });
    await tx.listingQuestion.deleteMany({ where: { businessId: { in: businesses } } });
    await tx.staffInvitation.deleteMany({ where: { businessId: { in: businesses } } });
    await tx.product.deleteMany({ where: { businessId: { in: businesses } } });
    await tx.business.deleteMany({ where: { id: { in: businesses } } });
    await tx.cmsBanner.deleteMany({ where: { id: { in: cms.banners } } });
    await tx.faqEntry.deleteMany({ where: { id: { in: cms.faqs } } });
    await tx.categoryAttribute.deleteMany({ where: { categoryId: { in: categories } } });
    await tx.attribute.deleteMany({ where: { id: { in: attributes } } });
    await tx.category.deleteMany({ where: { parentId: { in: categories } } });
    await tx.category.deleteMany({ where: { id: { in: categories } } });
    await tx.setting.deleteMany({ where: { key: { startsWith: `test.${tag}` } } });
  });
  // ops_events is append-only for the app; the owner removes the test rows.
  await owner.$executeRaw`DELETE FROM ops_events WHERE details->>'tag' = ${tag}`;
  await deleteUsers(...users);
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("taking listings down", () => {
  it("only TownMart can take a listing down; the seller can't clear it", async () => {
    const s = await shop("td-guard");
    await expect(withRls(s.ctx, (tx) => tx.product.update({ where: { id: s.productId }, data: { takenDownAt: new Date(), takenDownReason: "self" } }))).rejects.toThrow(/TownMart/);
    const a = await admin();
    await withRls(a, (tx) => takeDownListing(tx, { kind: "product", id: s.productId }, { reason: "Counterfeit", actorUserId: a.userId }));
    await expect(withRls(s.ctx, (tx) => tx.product.update({ where: { id: s.productId }, data: { takenDownAt: null } }))).rejects.toThrow(/TownMart/);
    // The seller can still edit other fields of their own listing.
    await withRls(s.ctx, (tx) => tx.product.update({ where: { id: s.productId }, data: { title: `Edited ${tag}` } }));
  });

  it("hides a taken-down listing from shoppers but not from its seller, and restores it", async () => {
    const s = await shop("td-hide");
    const shopper = await user("td-shopper");
    const a = await admin();
    await withRls(a, (tx) => takeDownListing(tx, { kind: "product", id: s.productId }, { reason: "Prohibited", actorUserId: a.userId }));
    expect(await withRls({ userId: null }, (tx) => tx.product.findUnique({ where: { id: s.productId } }))).toBeNull();
    expect(await withRls({ userId: shopper.id }, (tx) => tx.product.findUnique({ where: { id: s.productId } }))).toBeNull();
    const own = await withRls(s.ctx, (tx) => tx.product.findUnique({ where: { id: s.productId }, select: { takenDownReason: true } }));
    expect(own?.takenDownReason).toBe("Prohibited");
    await withRls(a, (tx) => restoreListing(tx, { kind: "product", id: s.productId }));
    expect(await withRls({ userId: null }, (tx) => tx.product.findUnique({ where: { id: s.productId }, select: { id: true } }))).toEqual({ id: s.productId });
  });

  it("closes open reports when a listing is taken down", async () => {
    const s = await shop("td-reports");
    const shopper = await user("td-reporter");
    await withRls({ userId: shopper.id }, (tx) => tx.listingReport.create({ data: { productId: s.productId, businessId: s.businessId, reporterUserId: shopper.id, reason: "counterfeit" } }));
    const a = await admin();
    const res = await withRls(a, (tx) => takeDownListing(tx, { kind: "product", id: s.productId }, { reason: "Fake", actorUserId: a.userId }));
    expect(res.reportsClosed).toBe(1);
    expect(await owner.listingReport.count({ where: { productId: s.productId, status: "open" } })).toBe(0);
  });

  it("flags listings that mention prohibited keywords, once", async () => {
    const s = await shop("td-keyword", `Tramadol tablets ${tag}`);
    expect(await screenListing({ kind: "product", id: s.productId })).toContain("tramadol");
    await screenListing({ kind: "product", id: s.productId });
    const flags = await owner.listingReport.findMany({ where: { productId: s.productId, reason: "keyword_match", status: "open" } });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.matched).toContain("tramadol");
  });
});

describe("listing reports", () => {
  it("a shopper reports for themselves only, and can't fake a keyword flag", async () => {
    const s = await shop("lr-own");
    const shopper = await user("lr-shopper");
    const other = await user("lr-other");
    await expect(withRls({ userId: shopper.id }, (tx) => tx.listingReport.create({ data: { productId: s.productId, businessId: s.businessId, reporterUserId: other.id, reason: "scam" } }))).rejects.toThrow(/row-level security/);
    await expect(withRls({ userId: shopper.id }, (tx) => tx.listingReport.create({ data: { productId: s.productId, businessId: s.businessId, reporterUserId: shopper.id, reason: "keyword_match" } }))).rejects.toThrow(/row-level security/);
    await expect(withRls({ userId: shopper.id }, (tx) => tx.listingReport.create({ data: { productId: s.productId, businessId: s.businessId, reporterUserId: shopper.id, reason: "scam", status: "actioned" } }))).rejects.toThrow(/row-level security/);
    await withRls({ userId: shopper.id }, (tx) => tx.listingReport.create({ data: { productId: s.productId, businessId: s.businessId, reporterUserId: shopper.id, reason: "scam" } }));
    // One open report per shopper per listing.
    await expect(withRls({ userId: shopper.id }, (tx) => tx.listingReport.create({ data: { productId: s.productId, businessId: s.businessId, reporterUserId: shopper.id, reason: "other" } }))).rejects.toMatchObject({ code: "P2002" });
  });

  it("reports are private to the reporter and TownMart, not the seller", async () => {
    const s = await shop("lr-private");
    const shopper = await user("lr-p-shopper");
    const stranger = await user("lr-p-stranger");
    await withRls({ userId: shopper.id }, (tx) => tx.listingReport.create({ data: { productId: s.productId, businessId: s.businessId, reporterUserId: shopper.id, reason: "misleading" } }));
    expect(await withRls({ userId: shopper.id }, (tx) => tx.listingReport.count({ where: { productId: s.productId } }))).toBe(1);
    expect(await withRls({ userId: stranger.id }, (tx) => tx.listingReport.count({ where: { productId: s.productId } }))).toBe(0);
    expect(await withRls(s.ctx, (tx) => tx.listingReport.count({ where: { productId: s.productId } }))).toBe(0);
    expect(await withRls(await admin(), (tx) => tx.listingReport.count({ where: { productId: s.productId } }))).toBe(1);
    await expect(withRls({ userId: shopper.id }, (tx) => tx.listingReport.updateMany({ where: { productId: s.productId }, data: { status: "dismissed" } }))).resolves.toMatchObject({ count: 0 });
  });
});

describe("questions on listings", () => {
  it("shows answered questions to everyone and a waiting one only to its asker and the shop", async () => {
    const s = await shop("q-vis");
    const asker = await user("q-asker");
    const other = await user("q-other");
    const q = await withRls({ userId: asker.id }, (tx) => tx.listingQuestion.create({ data: { productId: s.productId, businessId: s.businessId, askerUserId: asker.id, askerName: "Asker", question: "Is it new?" } }));
    expect(await withRls({ userId: other.id }, (tx) => tx.listingQuestion.count({ where: { id: q.id } }))).toBe(0);
    expect(await withRls({ userId: asker.id }, (tx) => tx.listingQuestion.count({ where: { id: q.id } }))).toBe(1);
    expect(await withRls(s.ctx, (tx) => tx.listingQuestion.count({ where: { id: q.id } }))).toBe(1);
    await withRls(s.ctx, (tx) => tx.listingQuestion.update({ where: { id: q.id }, data: { answer: "Yes, sealed.", answeredBy: s.userId, answeredAt: new Date() } }));
    expect(await withRls({ userId: null }, (tx) => tx.listingQuestion.count({ where: { id: q.id } }))).toBe(1);
  });

  it("an asker can't pre-answer, another shop can't answer, and only TownMart can hide", async () => {
    const s = await shop("q-guard");
    const rival = await shop("q-rival");
    const asker = await user("q-g-asker");
    await expect(
      withRls({ userId: asker.id }, (tx) => tx.listingQuestion.create({ data: { productId: s.productId, businessId: s.businessId, askerUserId: asker.id, askerName: "A", question: "Fake answer?", answer: "Yes!" } })),
    ).rejects.toThrow(/row-level security/);
    const q = await withRls({ userId: asker.id }, (tx) => tx.listingQuestion.create({ data: { productId: s.productId, businessId: s.businessId, askerUserId: asker.id, askerName: "A", question: "Real question?" } }));
    expect((await withRls(rival.ctx, (tx) => tx.listingQuestion.updateMany({ where: { id: q.id }, data: { answer: "Buy ours" } }))).count).toBe(0);
    await expect(withRls(s.ctx, (tx) => tx.listingQuestion.update({ where: { id: q.id }, data: { status: "hidden" } }))).rejects.toThrow(/TownMart/);
    await expect(withRls(s.ctx, (tx) => tx.listingQuestion.update({ where: { id: q.id }, data: { question: "Edited by seller" } }))).rejects.toThrow(/permission denied/);
    await withRls(await admin(), (tx) => tx.listingQuestion.update({ where: { id: q.id }, data: { status: "hidden" } }));
  });
});

describe("staff invitations", () => {
  it("are kept to their shop", async () => {
    const a = await shop("si-a");
    const b = await shop("si-b");
    const inv = await withRls(a.ctx, (tx) =>
      tx.staffInvitation.create({ data: { businessId: a.businessId, email: `helper-${tag}@test.townmart.local`, permissions: { orders: true }, tokenHash: `hash-${tag}`, invitedBy: a.userId, expiresAt: new Date(Date.now() + 86_400_000) } }),
    );
    expect(await withRls(b.ctx, (tx) => tx.staffInvitation.count({ where: { id: inv.id } }))).toBe(0);
    expect((await withRls(b.ctx, (tx) => tx.staffInvitation.updateMany({ where: { id: inv.id }, data: { revokedAt: new Date() } }))).count).toBe(0);
    await expect(
      withRls(b.ctx, (tx) => tx.staffInvitation.create({ data: { businessId: a.businessId, email: `x-${tag}@test.townmart.local`, tokenHash: `hash2-${tag}`, invitedBy: b.userId, expiresAt: new Date() } })),
    ).rejects.toThrow(/row-level security/);
    // One pending invitation per email per shop.
    await expect(
      withRls(a.ctx, (tx) => tx.staffInvitation.create({ data: { businessId: a.businessId, email: `HELPER-${tag}@test.townmart.local`, tokenHash: `hash3-${tag}`, invitedBy: a.userId, expiresAt: new Date() } })),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("content and reference data", () => {
  it("shoppers see only live banners and published answers, and can't write either", async () => {
    const now = Date.now();
    const rows = await asSystem((tx) =>
      Promise.all([
        tx.cmsBanner.create({ data: { title: `Live ${tag}` } }),
        tx.cmsBanner.create({ data: { title: `Off ${tag}`, isActive: false } }),
        tx.cmsBanner.create({ data: { title: `Later ${tag}`, startsAt: new Date(now + 86_400_000) } }),
        tx.cmsBanner.create({ data: { title: `Over ${tag}`, startsAt: new Date(now - 2 * 86_400_000), endsAt: new Date(now - 86_400_000) } }),
      ]),
    );
    cms.banners.push(...rows.map((r) => r.id));
    const seen = await withRls({ userId: null }, (tx) => tx.cmsBanner.findMany({ where: { id: { in: cms.banners } }, select: { title: true } }));
    expect(seen.map((b) => b.title)).toEqual([`Live ${tag}`]);
    const faq = await asSystem((tx) => tx.faqEntry.create({ data: { section: "Test", question: `Draft ${tag}?`, answerHtml: "<p>x</p>", isPublished: false } }));
    cms.faqs.push(faq.id);
    expect(await withRls({ userId: null }, (tx) => tx.faqEntry.count({ where: { id: faq.id } }))).toBe(0);
    const u = await user("cms-writer");
    await expect(withRls({ userId: u.id }, (tx) => tx.cmsBanner.create({ data: { title: "Mine" } }))).rejects.toThrow(/row-level security/);
    await expect(withRls({ userId: u.id }, (tx) => tx.cmsPage.update({ where: { slug: "about" }, data: { title: "Hacked" } }))).rejects.toThrow();
  });

  it("only TownMart changes categories, attributes and settings", async () => {
    const s = await shop("ref-seller");
    await expect(withRls(s.ctx, (tx) => tx.category.create({ data: { name: "Mine", slug: `mine-${tag}`, kind: "product" } }))).rejects.toThrow(/row-level security/);
    await expect(withRls(s.ctx, (tx) => tx.attribute.create({ data: { name: "Mine", slug: `mine_${tag}` } }))).rejects.toThrow(/row-level security/);
    await expect(withRls(s.ctx, (tx) => tx.setting.create({ data: { key: `test.${tag}.x`, value: 1 } }))).rejects.toThrow(/row-level security/);
    expect((await withRls(s.ctx, (tx) => tx.setting.updateMany({ where: { key: "fees.vat_percent" }, data: { value: 0 } }))).count).toBe(0);
    // Everyone can read them.
    expect(await withRls({ userId: null }, (tx) => tx.category.count())).toBeGreaterThan(0);
    const a = await admin();
    const c = await withRls(a, (tx) => tx.category.create({ data: { name: `Admin ${tag}`, slug: `admin-${tag}`, kind: "product" } }));
    categories.push(c.id);
    await withRls(a, (tx) => tx.setting.create({ data: { key: `test.${tag}.y`, value: 2 } }));
  });

  it("the ops log is append-only and TownMart's alone", async () => {
    const a = await admin();
    const ev = await withSystemContext((tx) => tx.opsEvent.create({ data: { kind: "backup", succeeded: true, startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), details: { tag } } }));
    expect(await withRls(a, (tx) => tx.opsEvent.count({ where: { id: ev.id } }))).toBe(1);
    const u = await user("ops-reader");
    expect(await withRls({ userId: u.id }, (tx) => tx.opsEvent.count({ where: { id: ev.id } }))).toBe(0);
    await expect(withRls(a, (tx) => tx.opsEvent.update({ where: { id: ev.id }, data: { succeeded: false } }))).rejects.toThrow(/permission denied/);
    await expect(withRls(a, (tx) => tx.opsEvent.delete({ where: { id: ev.id } }))).rejects.toThrow(/permission denied/);
  });
});

describe("category attributes", () => {
  it("a subcategory asks for its parent's attributes too, and saving checks required ones", async () => {
    const a = await admin();
    const s = await shop("attr-seller");
    const { parent, child, attr } = await withRls(a, async (tx) => {
      const parent = await tx.category.create({ data: { name: `P ${tag}`, slug: `p-${tag}`, kind: "product" } });
      const child = await tx.category.create({ data: { name: `C ${tag}`, slug: `c-${tag}`, kind: "product", parentId: parent.id } });
      const attr = await tx.attribute.create({ data: { name: "Grade", slug: `grade_${tag}`, type: "select", options: ["A", "B"] } });
      const other = await tx.attribute.create({ data: { name: "Weight", slug: `weight_${tag}`, type: "number" } });
      await tx.categoryAttribute.create({ data: { categoryId: parent.id, attributeId: attr.id, isRequired: true } });
      await tx.categoryAttribute.create({ data: { categoryId: child.id, attributeId: other.id } });
      attributes.push(attr.id, other.id);
      return { parent, child, attr };
    });
    categories.push(parent.id);
    const defs = (await withRls({ userId: null }, (tx) => categoryAttributeDefs(tx, [child.id]))).get(child.id)!;
    expect(defs.map((d) => [d.slug, d.isRequired])).toEqual([
      [`grade_${tag}`, true],
      [`weight_${tag}`, false],
    ]);

    const data = {
      title: `Graded ${tag}`,
      descriptionHtml: "",
      categoryId: child.id,
      tags: [],
      unit: "piece",
      minOrderQty: "1",
      allowFractionalQty: false,
      trackInventory: true,
      allowBackorder: false,
      isPerishable: false,
      costPrice: null,
      status: "draft",
      slug: "",
      options: [],
      variants: [{ sku: `G-${tag}`, optionValues: {}, price: 100_000n, compareAtPrice: null, stockQty: "1", lowStockThreshold: "1" }],
      images: [],
      attributes: {},
    } as unknown as ProductData;
    const save = (attrs: Record<string, string>) => withRls(s.ctx, (tx) => saveProduct(tx, { businessId: s.businessId, actorUserId: s.userId, data: { ...data, attributes: attrs } }));
    await expect(save({})).rejects.toBeInstanceOf(CatalogueError);
    await expect(save({ [attr.slug]: "Z" })).rejects.toThrow(/Choose from the list/);
    const { productId } = await save({ [attr.slug]: "A", [`weight_${tag}`]: "2.5", junk: "x" });
    expect((await owner.product.findUniqueOrThrow({ where: { id: productId } })).attributes).toEqual({ [attr.slug]: "A", [`weight_${tag}`]: 2.5 });
  });
});

describe("analytics", () => {
  it("the daily series adds up to the period total", async () => {
    const d = await withRls(await admin(), (tx) => dashboard(tx, 30));
    expect(d.series).toHaveLength(30);
    expect(d.series.reduce((a, p) => a + p.gmvKobo, 0n)).toBe(d.totals.gmvKobo);
    expect(d.series.reduce((a, p) => a + p.orders, 0)).toBe(d.totals.orders);
    expect(d.totals.activeSellers).toBeLessThanOrEqual(d.totals.approvedSellers);
  });
});
