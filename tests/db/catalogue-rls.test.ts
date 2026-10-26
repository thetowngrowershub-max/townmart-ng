import { randomUUID } from "node:crypto";
import { Prisma, type BusinessStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@/lib/db";
import { adjustStock } from "@/lib/catalogue/products";
import { searchProvider } from "@/lib/search";
import { createUser, deleteUsers, lagosIkeja, owner } from "./helpers";

/**
 * Cross-seller isolation at the database layer: seller A, running with its own
 * business context, must never see or change seller B's private rows, and
 * must not be able to approve itself.
 */

type Fixture = { userId: string; businessId: string; draftProductId: string; activeProductId: string; variantId: string };

let a: Fixture;
let b: Fixture;
let pending: Fixture;
let categoryId: string;
const tag = randomUUID().slice(0, 8);

/** Fixtures are written by the table owner under the system scope, so the status guards allow approved rows. */
function asSystem<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
    return fn(tx);
  });
}

async function createSeller(label: string, status: BusinessStatus): Promise<Fixture> {
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
        status,
        kyc: { create: { verificationStatus: "pending", documentKeys: [`kyc/${label}.pdf`] } },
        payoutAccount: { create: { bankCode: "058", bankName: "GTBank", accountNumberLast4: "1234", accountName: label } },
      },
    });
    const product = async (title: string, status: "draft" | "active") => {
      const p = await tx.product.create({
        data: {
          businessId: business.id,
          categoryId,
          title: `${title} ${tag}`,
          slug: `${label}-${title.toLowerCase().replace(/\s+/g, "-")}-${tag}`,
          basePriceKobo: 150_000n,
          status,
        },
      });
      const v = await tx.productVariant.create({
        data: { productId: p.id, businessId: business.id, sku: `${label}-${title}-${tag}`, priceKobo: 150_000n, stockQty: 10, isDefault: true },
      });
      return { id: p.id, variantId: v.id };
    };
    const draft = await product("Draft lamp", "draft");
    const active = await product("Isolation kettle", "active");
    await tx.importJob.create({
      data: { businessId: business.id, fileKey: `imports/${label}.csv`, fileName: `${label}.csv`, createdBy: user.id },
    });
    return {
      userId: user.id,
      businessId: business.id,
      draftProductId: draft.id,
      activeProductId: active.id,
      variantId: active.variantId,
    };
  });
}

const as = (f: Fixture) => ({ userId: f.userId, businessId: f.businessId });

beforeAll(async () => {
  const category = await owner.category.findFirstOrThrow({ where: { kind: "product", isActive: true } });
  categoryId = category.id;
  a = await createSeller("seller-a", "approved");
  b = await createSeller("seller-b", "approved");
  pending = await createSeller("seller-p", "pending");
});

afterAll(async () => {
  const fixtures = [a, b, pending].filter(Boolean);
  const businessIds = fixtures.map((f) => f.businessId);
  await asSystem(async (tx) => {
    await tx.product.deleteMany({ where: { businessId: { in: businessIds } } });
    await tx.business.deleteMany({ where: { id: { in: businessIds } } });
  });
  await deleteUsers(...fixtures.map((f) => f.userId));
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("RLS: listings", () => {
  it("lets a seller read all of its own products, drafts included", async () => {
    const rows = await withRls(as(a), (tx) => tx.product.findMany({ where: { businessId: a.businessId } }));
    expect(rows.map((r) => r.id).sort()).toEqual([a.draftProductId, a.activeProductId].sort());
  });

  it("hides another seller's drafts but shows its public listings", async () => {
    const rows = await withRls(as(a), (tx) => tx.product.findMany({ where: { businessId: b.businessId } }));
    expect(rows.map((r) => r.id)).toEqual([b.activeProductId]);
    const draft = await withRls(as(a), (tx) => tx.product.findUnique({ where: { id: b.draftProductId } }));
    expect(draft).toBeNull();
  });

  it("shows guests only active listings of approved businesses", async () => {
    const rows = await withRls({ userId: null }, (tx) =>
      tx.product.findMany({ where: { businessId: { in: [a.businessId, b.businessId, pending.businessId] } } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([a.activeProductId, b.activeProductId].sort());
  });

  it("can't update or delete another seller's product, even a public one", async () => {
    const updated = await withRls(as(a), (tx) =>
      tx.product.updateMany({ where: { id: b.activeProductId }, data: { title: "hijacked" } }),
    );
    const deleted = await withRls(as(a), (tx) => tx.product.deleteMany({ where: { id: b.activeProductId } }));
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
    const still = await owner.product.findUniqueOrThrow({ where: { id: b.activeProductId } });
    expect(still.title).toBe(`Isolation kettle ${tag}`);
  });

  it("can't create a product under another business", async () => {
    await expect(
      withRls(as(a), (tx) =>
        tx.product.create({ data: { businessId: b.businessId, categoryId, title: "x", slug: `x-${tag}`, basePriceKobo: 1n } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("can't change another seller's variant prices or stock", async () => {
    const updated = await withRls(as(a), (tx) =>
      tx.productVariant.updateMany({ where: { id: b.variantId }, data: { priceKobo: 1n, stockQty: 0 } }),
    );
    expect(updated.count).toBe(0);
  });

  it("can't attach a variant of its own to another seller's product", async () => {
    await expect(
      withRls(as(a), (tx) =>
        tx.productVariant.create({ data: { productId: b.activeProductId, businessId: a.businessId, sku: `smuggle-${tag}`, priceKobo: 1n } }),
      ),
    ).rejects.toThrow();
  });
});

describe("RLS: stock", () => {
  it("adjusts its own stock and logs the movement", async () => {
    const change = await withRls(as(a), (tx) =>
      adjustStock(tx, { businessId: a.businessId, variantId: a.variantId, change: "-3", reason: "manual_adjustment" }),
    );
    expect(change.after.toString()).toBe("7");
    const moves = await withRls(as(a), (tx) => tx.stockMovement.findMany({ where: { variantId: a.variantId } }));
    expect(moves).toHaveLength(1);
    expect(moves[0]!.balanceAfter.toString()).toBe("7");
  });

  it("refuses to take stock below zero and rolls the change back", async () => {
    await expect(
      withRls(as(a), (tx) => adjustStock(tx, { businessId: a.businessId, variantId: a.variantId, change: "-100", reason: "manual_adjustment" })),
    ).rejects.toThrow(/below zero/);
    const v = await owner.productVariant.findUniqueOrThrow({ where: { id: a.variantId } });
    expect(v.stockQty.toString()).toBe("7");
  });

  it("can't adjust another seller's stock, even by naming its business", async () => {
    await expect(
      withRls(as(a), (tx) => adjustStock(tx, { businessId: b.businessId, variantId: b.variantId, change: "5", reason: "manual_adjustment" })),
    ).rejects.toThrow(/not found/i);
    const v = await owner.productVariant.findUniqueOrThrow({ where: { id: b.variantId } });
    expect(v.stockQty.toString()).toBe("10");
  });

  it("hides other sellers' stock movements and keeps the log append-only", async () => {
    await withRls(as(b), (tx) => adjustStock(tx, { businessId: b.businessId, variantId: b.variantId, change: "1", reason: "manual_adjustment" }));
    const seen = await withRls(as(a), (tx) => tx.stockMovement.findMany({ where: { businessId: b.businessId } }));
    expect(seen).toEqual([]);
    await expect(
      withRls(as(b), (tx) => tx.stockMovement.updateMany({ where: { businessId: b.businessId }, data: { note: "edited" } })),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("RLS: private seller data", () => {
  it("hides KYC, payout accounts and import jobs from other sellers and guests", async () => {
    for (const ctx of [as(a), { userId: null }]) {
      const [kyc, payout, jobs] = await withRls(ctx, async (tx) => [
        await tx.businessKyc.findMany({ where: { businessId: b.businessId } }),
        await tx.payoutAccount.findMany({ where: { businessId: b.businessId } }),
        await tx.importJob.findMany({ where: { businessId: b.businessId } }),
      ]);
      expect(kyc).toEqual([]);
      expect(payout).toEqual([]);
      expect(jobs).toEqual([]);
    }
  });

  it("lets a seller read its own private data", async () => {
    const [kyc, payout] = await withRls(as(b), async (tx) => [
      await tx.businessKyc.findUnique({ where: { businessId: b.businessId } }),
      await tx.payoutAccount.findUnique({ where: { businessId: b.businessId } }),
    ]);
    expect(kyc?.documentKeys).toEqual(["kyc/seller-b.pdf"]);
    expect(payout?.accountNumberLast4).toBe("1234");
  });

  it("can't redirect another seller's payouts", async () => {
    const updated = await withRls(as(a), (tx) =>
      tx.payoutAccount.updateMany({ where: { businessId: b.businessId }, data: { bankCode: "999" } }),
    );
    expect(updated.count).toBe(0);
  });

  it("can't edit another seller's business profile", async () => {
    const updated = await withRls(as(a), (tx) => tx.business.updateMany({ where: { id: b.businessId }, data: { name: "hijacked" } }));
    expect(updated.count).toBe(0);
  });
});

describe("Status guards", () => {
  it("won't let a seller approve its own business", async () => {
    await expect(
      withRls(as(pending), (tx) => tx.business.update({ where: { id: pending.businessId }, data: { status: "approved" } })),
    ).rejects.toThrow(/requires an admin/);
  });

  it("won't let a seller create a business that is already approved", async () => {
    const { stateId, lgaId } = await lagosIkeja();
    await expect(
      withRls({ userId: a.userId }, (tx) =>
        tx.business.create({
          data: {
            ownerUserId: a.userId,
            type: "merchant",
            name: "Shortcut",
            slug: `shortcut-${tag}`,
            email: `shortcut-${tag}@test.townmart.local`,
            phoneEncrypted: "x",
            phoneHash: `shortcut-${tag}`,
            addressEncrypted: "x",
            city: "Ikeja",
            stateId,
            lgaId,
            status: "approved",
          },
        }),
      ),
    ).rejects.toThrow(/must start as draft/);
  });

  it("won't let a seller mark its own KYC verified", async () => {
    await expect(
      withRls(as(pending), (tx) =>
        tx.businessKyc.update({ where: { businessId: pending.businessId }, data: { verificationStatus: "verified" } }),
      ),
    ).rejects.toThrow(/managed by TownMart/);
  });

  it("won't let a seller set its own rating", async () => {
    await expect(
      withRls(as(a), (tx) => tx.business.update({ where: { id: a.businessId }, data: { ratingAvg: new Prisma.Decimal(5) } })),
    ).rejects.toThrow(/managed by TownMart/);
  });

  it("lets the admin scope approve", async () => {
    await withRls({ scope: "admin", userId: a.userId }, (tx) =>
      tx.business.update({ where: { id: pending.businessId }, data: { status: "approved" } }),
    );
    await asSystem((tx) => tx.business.update({ where: { id: pending.businessId }, data: { status: "pending" } }));
  });
});

describe("Search", () => {
  it("returns only live listings from approved sellers", async () => {
    const results = await searchProvider().search({ q: `kettle ${tag}`, kind: "products", sort: "relevance", page: 1, pageSize: 20 });
    const ids = results.products.items.map((p) => p.id).sort();
    expect(ids).toEqual([a.activeProductId, b.activeProductId].sort());
  });

  it("filters to one store", async () => {
    const results = await searchProvider().search({ kind: "products", businessId: b.businessId, sort: "newest", page: 1, pageSize: 20 });
    expect(results.products.items.map((p) => p.id)).toEqual([b.activeProductId]);
  });
});
