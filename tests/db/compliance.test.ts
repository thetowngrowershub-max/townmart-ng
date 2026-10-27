import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls, withSystemContext } from "@/lib/db";
import { purgeAbandonedCarts, purgeOldLogs, purgeUnverifiedAccounts, purgeUnverifiedRequests } from "@/lib/compliance/retention-jobs";
import { currentDocuments, recordAcceptances } from "@/lib/legal/documents";
import { marketingAudience, unsubscribe } from "@/lib/marketing";
import { anonymiseAccount, anonymisedEmail, requestAccountDeletion, restoreAccount } from "@/lib/privacy/account";
import { collectPersonalData } from "@/lib/privacy/export";
import { createDataRequest, DataRequestError } from "@/lib/privacy/requests";
import { createAddress, createBareOrder, createUser, deleteUsers, lagosIkeja, owner } from "./helpers";

/**
 * Phase 6 at the database layer: policy acceptances and consent are
 * append-only and private; data requests and the compliance registers are
 * TownMart's alone; account deletion, restore and anonymisation; the
 * retention jobs; the marketing audience; the data export.
 */

const tag = randomUUID().slice(0, 8);
const users: string[] = [];
const businesses: string[] = [];
const orders: string[] = [];
const DAY = 86_400_000;

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

/** An approved shop with one product, owned by a new user. */
async function shop(label: string) {
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
    const product = await tx.product.create({
      data: { businessId: business.id, categoryId, title: `${label} item ${tag}`, slug: `${label}-item-${tag}`, basePriceKobo: 100_000n, status: "active" },
    });
    return { userId: ownerUser.id, businessId: business.id, productId: product.id };
  });
}

async function order(userId: string | null) {
  const o = await createBareOrder(userId);
  orders.push(o.id);
  return o;
}

/** A published product review by `userId`, on a (bare) order from the shop. */
async function reviewFor(s: { businessId: string; productId: string }, userId: string, authorName: string) {
  const o = await order(userId);
  return asSystem(async (tx) => {
    const so = await tx.sellerOrder.create({
      data: { orderId: o.id, businessId: s.businessId, orderNumber: o.orderNumber, subtotalKobo: 0n, discountKobo: 0n, deliveryKobo: 0n, commissionKobo: 0n, sellerNetKobo: 0n, deliveryMethod: "pickup" },
    });
    const item = await tx.orderItem.create({
      data: { sellerOrderId: so.id, businessId: s.businessId, productId: s.productId, snapshot: {}, unitPriceKobo: 0n, qty: 1, subtotalKobo: 0n, discountKobo: 0n, lineTotalKobo: 0n },
    });
    return tx.review.create({ data: { targetType: "product", productId: s.productId, orderItemId: item.id, businessId: s.businessId, userId, authorName, rating: 5, body: "Good" } });
  });
}

beforeAll(async () => {
  // The seed publishes every legal page; these tests rely on it.
  expect((await withSystemContext((tx) => currentDocuments(tx, ["terms", "privacy", "refunds", "seller-agreement", "dpa", "prohibited-items"]))).size).toBe(6);
});

afterAll(async () => {
  await asSystem(async (tx) => {
    await tx.review.deleteMany({ where: { businessId: { in: businesses } } });
    await tx.order.deleteMany({ where: { id: { in: orders } } });
    await tx.product.deleteMany({ where: { businessId: { in: businesses } } });
    await tx.business.deleteMany({ where: { id: { in: businesses } } });
    await tx.marketingSuppression.deleteMany({ where: { email: { contains: tag } } });
  });
  await deleteUsers(...users);
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("policy acceptances", () => {
  it("records the current versions at sign-up, for the user only", async () => {
    const u = await user("pa-signup");
    const stranger = await user("pa-stranger");
    const versions = await withRls({ userId: u.id }, (tx) => recordAcceptances(tx, { context: "sign_up", userId: u.id, ipHash: "h", userAgent: "x".repeat(400) }));
    const current = await withSystemContext((tx) => currentDocuments(tx, ["terms", "privacy"]));
    expect(versions).toEqual({ terms: current.get("terms")!.version, privacy: current.get("privacy")!.version });

    const mine = await withRls({ userId: u.id }, (tx) => tx.policyAcceptance.findMany({ where: { userId: u.id } }));
    expect(mine).toHaveLength(2);
    expect(mine.every((a) => a.context === "sign_up" && a.userAgent!.length === 255)).toBe(true);
    expect(await withRls({ userId: stranger.id }, (tx) => tx.policyAcceptance.findMany({ where: { userId: u.id } }))).toEqual([]);
  });

  it("won't let anyone record an acceptance for someone else or another shop", async () => {
    const u = await user("pa-forger");
    const victim = await user("pa-victim");
    const mine = await shop("pa-myshop");
    const other = await shop("pa-othershop");
    await expect(withRls({ userId: u.id }, (tx) => recordAcceptances(tx, { context: "sign_up", userId: victim.id }))).rejects.toThrow(/row-level security/);
    await expect(
      withRls({ userId: mine.userId, businessId: mine.businessId }, (tx) => recordAcceptances(tx, { context: "seller_onboarding", userId: mine.userId, businessId: other.businessId })),
    ).rejects.toThrow(/row-level security/);
  });

  it("records seller onboarding against the shop, readable by the shop", async () => {
    const s = await shop("pa-seller");
    const versions = await withRls({ userId: s.userId, businessId: s.businessId }, (tx) =>
      recordAcceptances(tx, { context: "seller_onboarding", userId: s.userId, businessId: s.businessId, slugs: ["seller-agreement", "dpa", "prohibited-items", "service-provider-terms"] }),
    );
    expect(Object.keys(versions).sort()).toEqual(["dpa", "prohibited-items", "seller-agreement", "service-provider-terms"]);
    const rows = await withRls({ userId: s.userId, businessId: s.businessId }, (tx) => tx.policyAcceptance.findMany({ where: { businessId: s.businessId } }));
    expect(rows).toHaveLength(4);
  });

  it("records a guest checkout against the order", async () => {
    const o = await order(null);
    await withSystemContext((tx) => recordAcceptances(tx, { context: "checkout", orderId: o.id }));
    const rows = await owner.policyAcceptance.findMany({ where: { orderId: o.id }, include: { document: { select: { slug: true } } } });
    expect(rows.map((r) => r.document.slug).sort()).toEqual(["refunds", "terms"]);
    expect(rows.every((r) => r.userId === null)).toBe(true);
  });

  it("is append-only, even for TownMart code", async () => {
    const u = await user("pa-append");
    await withRls({ userId: u.id }, (tx) => recordAcceptances(tx, { context: "sign_up", userId: u.id }));
    const row = await owner.policyAcceptance.findFirstOrThrow({ where: { userId: u.id } });
    await expect(withSystemContext((tx) => tx.policyAcceptance.update({ where: { id: row.id }, data: { ipHash: "changed" } }))).rejects.toThrow(/permission denied/);
    await expect(withSystemContext((tx) => tx.policyAcceptance.delete({ where: { id: row.id } }))).rejects.toThrow(/permission denied/);
  });
});

describe("consent records", () => {
  it("are written by TownMart code, read only by their owner, and never changed", async () => {
    const u = await user("consent");
    const stranger = await user("consent-stranger");
    const subjectId = randomUUID();
    await expect(
      withRls({ userId: u.id }, (tx) => tx.consentRecord.createMany({ data: [{ subjectId, userId: u.id, functional: true, analytics: true, marketing: true, policyVersion: "v", source: "banner" }] })),
    ).rejects.toThrow(/row-level security/);
    const rec = await withSystemContext((tx) => tx.consentRecord.create({ data: { subjectId, userId: u.id, functional: true, analytics: false, marketing: false, policyVersion: "v", source: "banner" } }));
    expect(await withRls({ userId: u.id }, (tx) => tx.consentRecord.count({ where: { subjectId } }))).toBe(1);
    expect(await withRls({ userId: stranger.id }, (tx) => tx.consentRecord.count({ where: { subjectId } }))).toBe(0);
    expect(await withRls({ userId: null }, (tx) => tx.consentRecord.count({ where: { subjectId } }))).toBe(0);
    await expect(withSystemContext((tx) => tx.consentRecord.update({ where: { id: rec.id }, data: { analytics: true } }))).rejects.toThrow(/permission denied/);
    await expect(withSystemContext((tx) => tx.consentRecord.delete({ where: { id: rec.id } }))).rejects.toThrow(/permission denied/);
  });
});

describe("data requests and compliance registers", () => {
  it("lets requesters read their own requests and nothing else", async () => {
    const u = await user("dsr");
    const stranger = await user("dsr-stranger");
    const r = await withSystemContext((tx) => createDataRequest(tx, { type: "access", userId: u.id, email: u.email, channel: "privacy_centre", verified: true }));
    expect(r.reference).toMatch(/^DSR-\d{4}-\d{6}$/);
    expect(r.status).toBe("open");
    expect(r.dueAt!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(await withRls({ userId: u.id }, (tx) => tx.dataSubjectRequest.count({ where: { id: r.id } }))).toBe(1);
    expect(await withRls({ userId: stranger.id }, (tx) => tx.dataSubjectRequest.count({ where: { id: r.id } }))).toBe(0);
    await expect(withRls({ userId: u.id }, (tx) => tx.dataSubjectRequest.update({ where: { id: r.id }, data: { status: "completed" } }))).rejects.toThrow();
    await expect(
      withRls({ userId: u.id }, (tx) => tx.dataSubjectRequest.createMany({ data: [{ reference: `X-${tag}`, type: "access", status: "open", userId: u.id, email: u.email, channel: "privacy_centre" }] })),
    ).rejects.toThrow(/row-level security/);
  });

  it("keeps the registers to admin and system scope", async () => {
    const u = await user("registers");
    const asUser = <T,>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => withRls({ userId: u.id }, fn);
    expect(await asUser((tx) => tx.retentionSetting.count())).toBe(0);
    expect(await asUser((tx) => tx.dataProcessor.count())).toBe(0);
    expect(await asUser((tx) => tx.processingActivity.count())).toBe(0);
    expect(await asUser((tx) => tx.breachIncident.count())).toBe(0);
    expect(await asUser((tx) => tx.marketingSuppression.count())).toBe(0);
    expect(await withRls({ userId: u.id, scope: "admin" }, (tx) => tx.retentionSetting.count())).toBeGreaterThan(0);
    await expect(asUser((tx) => tx.retentionSetting.updateMany({ data: { days: 1 } }))).resolves.toEqual({ count: 0 });
    await expect(asUser((tx) => tx.marketingSuppression.createMany({ data: [{ email: `x-${tag}@test.townmart.local`, source: "t" }] }))).rejects.toThrow(/row-level security/);
    await expect(
      asUser((tx) => tx.breachIncident.createMany({ data: [{ reference: `BR-${tag}`, title: "t", description: "t", detectedAt: new Date(), awareAt: new Date(), risk: "low", createdBy: u.id }] })),
    ).rejects.toThrow(/row-level security/);
    await expect(asUser((tx) => tx.legalDocument.updateMany({ data: { title: "x" } }))).resolves.toEqual({ count: 0 });
  });
});

describe("deleting an account", () => {
  it("starts a grace period that signing in cancels", async () => {
    const u = await user("delete-restore");
    await owner.session.create({ data: { sessionToken: `t-${randomUUID()}`, userId: u.id, expires: new Date(Date.now() + DAY) } });
    const r = await withSystemContext((tx) => requestAccountDeletion(tx, { userId: u.id, reason: "test" }));
    expect(r.type).toBe("erasure");
    expect(r.dueAt!.getTime()).toBeGreaterThan(Date.now() + 13 * DAY);
    const pending = await owner.user.findUniqueOrThrow({ where: { id: u.id }, include: { sessions: true } });
    expect(pending.status).toBe("pending_deletion");
    expect(pending.sessions).toEqual([]);
    await expect(withSystemContext((tx) => requestAccountDeletion(tx, { userId: u.id }))).rejects.toThrow(DataRequestError);

    expect(await withSystemContext((tx) => restoreAccount(tx, u.id))).toBe(true);
    expect((await owner.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("active");
    expect((await owner.dataSubjectRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("cancelled");
    expect(await withSystemContext((tx) => restoreAccount(tx, u.id))).toBe(false);
  });

  it("is handled by hand for shop owners", async () => {
    const s = await shop("delete-owner");
    await expect(withSystemContext((tx) => requestAccountDeletion(tx, { userId: s.userId }))).rejects.toThrow(/run a shop/);
  });

  it("anonymises the person but keeps the order and its money", async () => {
    const s = await shop("anon-shop");
    const u = await user("anon");
    await withRls({ userId: u.id }, (tx) => recordAcceptances(tx, { context: "sign_up", userId: u.id }));
    await createAddress(u.id);
    await withSystemContext((tx) => tx.notificationPreference.create({ data: { userId: u.id, marketingEmail: true, marketingEmailAt: new Date() } }));
    const o = await order(u.id);
    const review = await reviewFor(s, u.id, "Anon T.");
    const r = await withSystemContext((tx) => requestAccountDeletion(tx, { userId: u.id }));

    await withSystemContext((tx) => anonymiseAccount(tx, u.id));

    const after = await owner.user.findUniqueOrThrow({ where: { id: u.id }, include: { addresses: true, roles: true, notificationPrefs: true } });
    expect(after).toMatchObject({ email: anonymisedEmail(u.id), name: null, passwordHash: null, phoneEncrypted: null, status: "anonymised" });
    expect(after.addresses).toEqual([]);
    expect(after.roles).toEqual([]);
    expect(after.notificationPrefs).toBeNull();
    expect((await owner.review.findUniqueOrThrow({ where: { id: review.id } })).authorName).toBe("Former customer");
    expect(await owner.marketingSuppression.findUnique({ where: { email: u.email } })).not.toBeNull();
    const kept = await owner.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(kept.userId).toBe(u.id);
    expect(kept.totalKobo).toBe(o.totalKobo);
    expect((await owner.dataSubjectRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("completed");
    // What they agreed to stays on record.
    expect(await owner.policyAcceptance.count({ where: { userId: u.id } })).toBe(2);
    await owner.marketingSuppression.delete({ where: { email: u.email } });
  });

  it("lets only TownMart change a review's author name", async () => {
    const s = await shop("author-guard");
    const u = await user("author");
    const review = await reviewFor(s, u.id, "Real N.");
    await expect(
      withRls({ userId: s.userId, businessId: s.businessId }, (tx) => tx.review.update({ where: { id: review.id }, data: { authorName: "Someone else" } })),
    ).rejects.toThrow(/Only TownMart/);
    await withRls({ userId: s.userId, businessId: s.businessId }, (tx) => tx.review.update({ where: { id: review.id }, data: { sellerReply: "Thanks" } }));
    expect((await owner.review.findUniqueOrThrow({ where: { id: review.id } })).authorName).toBe("Real N.");
  });
});

describe("retention jobs", () => {
  it("removes carts nobody has touched for the period, and keeps the rest", async () => {
    const old = await owner.cart.create({ data: { guestTokenHash: `old-${randomUUID()}`, expiresAt: new Date(), updatedAt: new Date(Date.now() - 40 * DAY) } });
    const fresh = await owner.cart.create({ data: { guestTokenHash: `fresh-${randomUUID()}`, expiresAt: new Date(Date.now() + DAY) } });
    const { deleted } = await purgeAbandonedCarts();
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await owner.cart.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await owner.cart.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    await owner.cart.delete({ where: { id: fresh.id } });
  });

  it("removes old unverified sign-ups that never did anything, never staff or buyers", async () => {
    const created = new Date(Date.now() - 40 * DAY);
    const idle = await user("ret-idle");
    const buyer = await user("ret-buyer");
    const admin = await user("ret-admin");
    const recent = await user("ret-recent");
    const verified = await user("ret-verified");
    await owner.user.updateMany({ where: { id: { in: [idle.id, buyer.id, admin.id, verified.id] } }, data: { createdAt: created } });
    await owner.user.update({ where: { id: verified.id }, data: { emailVerified: created } });
    await owner.userRole.create({ data: { userId: admin.id, role: "admin" } });
    await order(buyer.id);

    await purgeUnverifiedAccounts();
    const left = (await owner.user.findMany({ where: { id: { in: [idle.id, buyer.id, admin.id, recent.id, verified.id] } }, select: { id: true } })).map((x) => x.id);
    expect(left.sort()).toEqual([buyer.id, admin.id, recent.id, verified.id].sort());
  });

  it("removes job logs and notifications older than the period", async () => {
    const u = await user("ret-logs");
    const long = new Date(Date.now() - 400 * DAY);
    const oldRun = await owner.jobRun.create({ data: { jobName: `test-${tag}`, status: "succeeded", startedAt: long } });
    const stuck = await owner.jobRun.create({ data: { jobName: `test-${tag}`, status: "running", startedAt: long } });
    const newRun = await owner.jobRun.create({ data: { jobName: `test-${tag}`, status: "succeeded" } });
    await owner.notification.createMany({
      data: [
        { userId: u.id, type: "t", title: "old", body: "b", createdAt: long },
        { userId: u.id, type: "t", title: "new", body: "b" },
      ],
    });
    await purgeOldLogs();
    expect((await owner.jobRun.findMany({ where: { jobName: `test-${tag}` } })).map((r) => r.id).sort()).toEqual([stuck.id, newRun.id].sort());
    expect((await owner.notification.findMany({ where: { userId: u.id } })).map((n) => n.title)).toEqual(["new"]);
    expect(oldRun.id).toBeTruthy();
    await owner.jobRun.deleteMany({ where: { jobName: `test-${tag}` } });
  });

  it("removes public-form requests that were never confirmed", async () => {
    const email = `dsr-${tag}@test.townmart.local`;
    const [stale, waiting, confirmed] = await withSystemContext(async (tx) => [
      await createDataRequest(tx, { type: "access", userId: null, email, channel: "public_form", verified: false }),
      await createDataRequest(tx, { type: "access", userId: null, email, channel: "public_form", verified: false }),
      await createDataRequest(tx, { type: "access", userId: null, email, channel: "public_form", verified: true }),
    ]);
    await owner.dataSubjectRequest.updateMany({ where: { id: { in: [stale.id, confirmed.id] } }, data: { createdAt: new Date(Date.now() - 10 * DAY) } });
    await purgeUnverifiedRequests();
    const left = (await owner.dataSubjectRequest.findMany({ where: { email }, select: { id: true } })).map((x) => x.id);
    expect(left.sort()).toEqual([waiting.id, confirmed.id].sort());
    await owner.dataSubjectRequest.deleteMany({ where: { email } });
  });
});

describe("marketing", () => {
  it("sends only to people who opted in and haven't unsubscribed", async () => {
    const yes = await user("mk-yes");
    const no = await user("mk-no");
    await withSystemContext((tx) =>
      tx.notificationPreference.createMany({
        data: [
          { userId: yes.id, marketingEmail: true, marketingEmailAt: new Date() },
          { userId: no.id, marketingEmail: false },
        ],
      }),
    );
    const guest = await order(null);
    await owner.order.update({ where: { id: guest.id }, data: { isGuest: true, marketingConsent: true } });

    let audience = await withSystemContext((tx) => marketingAudience(tx));
    expect(audience).toContain(yes.email);
    expect(audience).toContain(guest.contactEmail);
    expect(audience).not.toContain(no.email);

    await withSystemContext(async (tx) => {
      await unsubscribe(tx, yes.email, "test");
      await unsubscribe(tx, guest.contactEmail, "test");
    });
    audience = await withSystemContext((tx) => marketingAudience(tx));
    expect(audience).not.toContain(yes.email);
    expect(audience).not.toContain(guest.contactEmail);
    expect((await owner.notificationPreference.findUniqueOrThrow({ where: { userId: yes.id } })).marketingEmail).toBe(false);
    await owner.marketingSuppression.deleteMany({ where: { email: { in: [yes.email, guest.contactEmail] } } });
  });
});

describe("data export", () => {
  it("collects the account's data, including guest orders placed with the same email", async () => {
    const u = await user("export");
    await createAddress(u.id);
    await withRls({ userId: u.id }, (tx) => recordAcceptances(tx, { context: "sign_up", userId: u.id }));
    const mine = await order(u.id);
    const guest = await order(null);
    await owner.order.update({ where: { id: guest.id }, data: { contactEmail: u.email, isGuest: true } });
    const someoneElse = await order(null);

    const data = await withSystemContext((tx) => collectPersonalData(tx, u.id));
    const json = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(json).toContain(u.email);
    expect(json).toContain(mine.orderNumber);
    expect(json).toContain(guest.orderNumber);
    expect(json).not.toContain(someoneElse.orderNumber);
    expect(json).not.toContain("v1.k1");
  });
});
