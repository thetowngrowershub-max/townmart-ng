import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls, withSystemContext } from "@/lib/db";
import { searchProvider } from "@/lib/search";
import { createUser, deleteUsers, lagosIkeja, owner } from "./helpers";

/**
 * Promotions at the database layer: a seller manages only its own promotions,
 * targets and coupons; coupon codes are never public; counters and
 * redemptions are written only by the system (checkout).
 */

type Fixture = { userId: string; businessId: string; productId: string; promotionId: string; couponPromotionId: string; pausedPromotionId: string };

let a: Fixture;
let b: Fixture;
let categoryId: string;
const tag = randomUUID().slice(0, 8);
const hour = 3_600_000;

function asSystem<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
    return fn(tx);
  });
}

async function createSeller(label: string): Promise<Fixture> {
  const user = await createUser(label);
  const { stateId, lgaId } = await lagosIkeja();
  return asSystem(async (tx) => {
    const business = await tx.business.create({
      data: {
        ownerUserId: user.id,
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
    const product = await tx.product.create({
      data: { businessId: business.id, categoryId, title: `Promo kettle ${tag}`, slug: `${label}-promo-kettle-${tag}`, basePriceKobo: 200_000n, status: "active" },
    });
    await tx.productVariant.create({ data: { productId: product.id, businessId: business.id, sku: `${label}-pk-${tag}`, priceKobo: 200_000n, stockQty: 5, isDefault: true } });
    const now = Date.now();
    const promo = (name: string, extra: Partial<Prisma.PromotionUncheckedCreateInput> = {}) =>
      tx.promotion.create({
        data: {
          businessId: business.id,
          name: `${name} ${tag}`,
          discountType: "percentage",
          discountValue: 10n,
          scope: "product",
          startsAt: new Date(now - hour),
          endsAt: new Date(now + 24 * hour),
          createdBy: user.id,
          targets: { create: [{ productId: product.id }] },
          ...extra,
        },
      });
    const live = await promo("Live sale");
    const withCoupon = await promo("Coupon sale", { scope: "store", targets: undefined, coupon: { create: { code: `${label.slice(-1)}CODE-${tag}`.toUpperCase().slice(0, 24) } } });
    const paused = await promo("Paused sale", { isActive: false });
    return { userId: user.id, businessId: business.id, productId: product.id, promotionId: live.id, couponPromotionId: withCoupon.id, pausedPromotionId: paused.id };
  });
}

const as = (f: Fixture) => ({ userId: f.userId, businessId: f.businessId });

beforeAll(async () => {
  categoryId = (await owner.category.findFirstOrThrow({ where: { kind: "product", isActive: true, parentId: { not: null } } })).id;
  a = await createSeller("promo-a");
  b = await createSeller("promo-b");
});

afterAll(async () => {
  const fixtures = [a, b].filter(Boolean);
  const businessIds = fixtures.map((f) => f.businessId);
  await asSystem(async (tx) => {
    await tx.promotionRedemption.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.promotion.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.product.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.business.deleteMany({ where: { id: { in: businessIds } } });
  });
  await deleteUsers(...fixtures.map((f) => f.userId));
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("RLS: promotions", () => {
  it("lets a seller see all of its own promotions, paused ones included", async () => {
    const rows = await withRls(as(a), (tx) => tx.promotion.findMany({ where: { businessId: a.businessId } }));
    expect(rows.map((r) => r.id).sort()).toEqual([a.promotionId, a.couponPromotionId, a.pausedPromotionId].sort());
  });

  it("shows guests and other sellers only live promotions", async () => {
    for (const ctx of [{ userId: null }, as(a)]) {
      const rows = await withRls(ctx, (tx) => tx.promotion.findMany({ where: { businessId: b.businessId } }));
      expect(rows.map((r) => r.id).sort()).toEqual([b.promotionId, b.couponPromotionId].sort());
    }
  });

  it("never shows a coupon code to guests or other sellers", async () => {
    const guest = await withRls({ userId: null }, (tx) => tx.coupon.findMany({ where: { businessId: { in: [a.businessId, b.businessId] } } }));
    expect(guest).toEqual([]);
    const other = await withRls(as(a), (tx) => tx.coupon.findMany({ where: { businessId: b.businessId } }));
    expect(other).toEqual([]);
    const own = await withRls(as(a), (tx) => tx.coupon.findMany({ where: { businessId: a.businessId } }));
    expect(own).toHaveLength(1);
  });

  it("can't update or delete another seller's promotion, even a live one", async () => {
    const updated = await withRls(as(a), (tx) => tx.promotion.updateMany({ where: { id: b.promotionId }, data: { discountValue: 100n } }));
    const deleted = await withRls(as(a), (tx) => tx.promotion.deleteMany({ where: { id: b.promotionId } }));
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
    expect((await owner.promotion.findUniqueOrThrow({ where: { id: b.promotionId } })).discountValue).toBe(10n);
  });

  it("can't create a promotion for another business", async () => {
    await expect(
      withRls(as(a), (tx) =>
        tx.promotion.create({
          data: { businessId: b.businessId, name: "x", discountType: "percentage", discountValue: 50n, scope: "store", startsAt: new Date(), endsAt: new Date(Date.now() + hour), createdBy: a.userId },
        }),
      ),
    ).rejects.toThrow();
  });

  it("can't create a platform-wide promotion", async () => {
    await expect(
      withRls(as(a), (tx) =>
        tx.promotion.create({ data: { name: "x", discountType: "percentage", discountValue: 50n, scope: "store", startsAt: new Date(), endsAt: new Date(Date.now() + hour), createdBy: a.userId } }),
      ),
    ).rejects.toThrow();
  });

  it("can't attach a target to another seller's promotion", async () => {
    await expect(withRls(as(a), (tx) => tx.promotionTarget.create({ data: { promotionId: b.couponPromotionId, productId: a.productId } }))).rejects.toThrow();
  });

  it("can't put another seller's product in its own promotion", async () => {
    await expect(withRls(as(a), (tx) => tx.promotionTarget.create({ data: { promotionId: a.couponPromotionId, productId: b.productId } }))).rejects.toThrow();
  });

  it("can't change or read another seller's coupon", async () => {
    const updated = await withRls(as(a), (tx) => tx.coupon.updateMany({ where: { promotionId: b.couponPromotionId }, data: { allowsStacking: true } }));
    expect(updated.count).toBe(0);
    await expect(withRls(as(a), (tx) => tx.coupon.create({ data: { promotionId: b.promotionId, code: `STEAL-${tag}` } }))).rejects.toThrow();
  });

  it("treats coupon codes case-insensitively across stores", async () => {
    const code = (await owner.coupon.findUniqueOrThrow({ where: { promotionId: b.couponPromotionId } })).code;
    await expect(withRls(as(a), (tx) => tx.coupon.create({ data: { promotionId: a.promotionId, code: code.toLowerCase() } }))).rejects.toThrow();
  });

  it("doesn't let a seller set its own usage counters", async () => {
    await expect(withRls(as(a), (tx) => tx.promotion.update({ where: { id: a.promotionId }, data: { redemptionCount: 99 } }))).rejects.toThrow();
    await expect(withRls(as(a), (tx) => tx.promotion.update({ where: { id: a.promotionId }, data: { hasCoupon: true } }))).rejects.toThrow();
  });
});

describe("RLS: redemptions", () => {
  it("are written only by the system, which keeps the count", async () => {
    await expect(
      withRls(as(a), (tx) => tx.promotionRedemption.create({ data: { promotionId: a.promotionId, orderId: randomUUID(), userId: a.userId, discountKobo: 1n } })),
    ).rejects.toThrow();

    await withSystemContext((tx) => tx.promotionRedemption.create({ data: { promotionId: a.promotionId, orderId: randomUUID(), userId: b.userId, discountKobo: 20_000n } }));
    expect((await owner.promotion.findUniqueOrThrow({ where: { id: a.promotionId } })).redemptionCount).toBe(1);
  });

  it("are visible to the seller and the customer, not to other sellers", async () => {
    const seller = await withRls(as(a), (tx) => tx.promotionRedemption.findMany({ where: { promotionId: a.promotionId } }));
    const customer = await withRls({ userId: b.userId }, (tx) => tx.promotionRedemption.findMany({ where: { promotionId: a.promotionId } }));
    const otherSeller = await withRls({ userId: randomUUID(), businessId: b.businessId }, (tx) => tx.promotionRedemption.findMany({ where: { promotionId: a.promotionId } }));
    expect(seller).toHaveLength(1);
    expect(customer).toHaveLength(1);
    expect(otherSeller).toEqual([]);
  });

  it("can't be edited or deleted, even by the seller", async () => {
    await expect(withRls(as(a), (tx) => tx.promotionRedemption.updateMany({ where: { promotionId: a.promotionId }, data: { discountKobo: 0n } }))).rejects.toThrow();
    await expect(withRls(as(a), (tx) => tx.promotionRedemption.deleteMany({ where: { promotionId: a.promotionId } }))).rejects.toThrow();
  });
});

describe("Search: on promotion", () => {
  it("finds only listings with a live automatic promotion and attaches the deal", async () => {
    const res = await searchProvider().search({ q: `kettle ${tag}`, kind: "products", promotion: "any", sort: "relevance", page: 1, pageSize: 10 });
    // Both sellers' kettles have a live 10% promotion; the deal is the final price.
    expect(res.products.items).toHaveLength(2);
    for (const hit of res.products.items) {
      expect(hit.deal?.finalKobo).toBe(180_000n);
      expect(hit.deal?.percentOff).toBe(10);
    }
  });
});
