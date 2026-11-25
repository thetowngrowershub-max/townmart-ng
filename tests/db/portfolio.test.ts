import { randomUUID } from "node:crypto";
import type { BusinessStatus, Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRls } from "@/lib/db";
import { listPortfolio, PortfolioError, replacePortfolio } from "@/lib/portfolio/portfolio";
import { createUser, deleteUsers, lagosIkeja, owner } from "./helpers";

/** Job photos: public while the shop is approved, written only by the shop itself. */

const tag = randomUUID().slice(0, 8);
type Seller = { userId: string; businessId: string };
let approved: Seller;
let other: Seller;
let pending: Seller;

function asSystem<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
    return fn(tx);
  });
}

async function createSeller(label: string, status: BusinessStatus): Promise<Seller> {
  const user = await createUser(label);
  const { stateId, lgaId } = await lagosIkeja();
  const business = await asSystem((tx) =>
    tx.business.create({
      data: {
        ownerUserId: user.id,
        type: "artisan",
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
        sellsServices: true,
      },
    }),
  );
  return { userId: user.id, businessId: business.id };
}

const asShop = <T>(s: Seller, fn: (tx: Prisma.TransactionClient) => Promise<T>) => withRls({ userId: s.userId, businessId: s.businessId }, fn);
const asGuest = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => withRls({ userId: null }, fn);
const photo = (s: Seller, caption = "Tiled a kitchen floor") => ({ key: `portfolios/${s.businessId}/${randomUUID()}.webp`, width: 800, height: 600, caption });

beforeAll(async () => {
  approved = await createSeller("tiler", "approved");
  other = await createSeller("painter", "approved");
  pending = await createSeller("welder", "pending");
});

afterAll(async () => {
  const ids = [approved, other, pending].map((s) => s.businessId);
  await asSystem((tx) => tx.business.deleteMany({ where: { id: { in: ids } } }));
  await deleteUsers(approved.userId, other.userId, pending.userId);
});

describe("job photos", () => {
  it("a shop saves its photos in order, and anyone can see them", async () => {
    const first = [photo(approved, "Before: cracked floor"), photo(approved, "After: new tiles")];
    await asShop(approved, (tx) => replacePortfolio(tx, approved.businessId, first));
    const seen = await asGuest((tx) => listPortfolio(tx, approved.businessId));
    expect(seen.map((p) => p.caption)).toEqual(["Before: cracked floor", "After: new tiles"]);

    // Saving again reorders and reports the dropped photo for deletion from storage.
    const { removed } = await asShop(approved, (tx) => replacePortfolio(tx, approved.businessId, [first[1]!]));
    expect(removed).toEqual([first[0]!.key]);
    expect((await asGuest((tx) => listPortfolio(tx, approved.businessId))).map((p) => p.key)).toEqual([first[1]!.key]);
  });

  it("photos of a shop that isn't approved stay private to it", async () => {
    await asShop(pending, (tx) => replacePortfolio(tx, pending.businessId, [photo(pending)]));
    expect(await asGuest((tx) => listPortfolio(tx, pending.businessId))).toHaveLength(0);
    expect(await asShop(pending, (tx) => listPortfolio(tx, pending.businessId))).toHaveLength(1);
  });

  it("a shop can't use another shop's photos or write to its portfolio", async () => {
    await expect(asShop(other, (tx) => replacePortfolio(tx, other.businessId, [photo(approved)]))).rejects.toBeInstanceOf(PortfolioError);
    await expect(
      asShop(other, (tx) => tx.portfolioPhoto.create({ data: { businessId: approved.businessId, ...{ storageKey: photo(approved).key, width: 1, height: 1, caption: "Not mine" } } })),
    ).rejects.toThrow();
    // Clearing its own portfolio doesn't touch anyone else's.
    await asShop(other, (tx) => tx.portfolioPhoto.deleteMany({ where: { businessId: approved.businessId } }));
    expect(await asGuest((tx) => listPortfolio(tx, approved.businessId))).toHaveLength(1);
  });

  it("the database refuses a photo key outside the shop's folder", async () => {
    await expect(
      asSystem((tx) => tx.portfolioPhoto.create({ data: { businessId: approved.businessId, storageKey: `portfolios/${other.businessId}/x.webp`, width: 1, height: 1, caption: "Wrong folder" } })),
    ).rejects.toThrow(/portfolio_photos_own_key/);
  });
});
