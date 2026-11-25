import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveService } from "@/lib/catalogue/services";
import { searchProvider } from "@/lib/search";
import { checkServiceArea } from "@/lib/service-area-db";
import { serviceInputSchema } from "@/lib/validation/catalogue";
import { createUser, deleteUsers, lagosIkeja, moweOgun, owner } from "./helpers";

/**
 * TownMart is open in Mowe, Obafemi-Owode, Ogun State only (lib/service-area.ts),
 * and service providers are locked to the LGA they're registered in.
 */

const tag = randomUUID().slice(0, 8);
const users: string[] = [];
let mowe: { businessId: string; productId: string; serviceId: string };
let lagos: { businessId: string; productId: string; serviceId: string };

function asSystem<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
    return fn(tx);
  });
}

async function createProvider(label: string, place: { stateId: number; lgaId: number; city: string }, serviceLgaIds: number[]) {
  const user = await createUser(label);
  users.push(user.id);
  const productCategory = await owner.category.findFirstOrThrow({ where: { kind: "product", parentId: { not: null } }, select: { id: true } });
  const serviceCategory = await owner.category.findFirstOrThrow({ where: { kind: "service", parentId: { not: null } }, select: { id: true } });
  return asSystem(async (tx) => {
    const business = await tx.business.create({
      data: {
        ownerUserId: user.id,
        type: "artisan",
        name: `${label} ${tag}`,
        slug: `${label}-${tag}`,
        email: `${label}-${tag}@test.townmart.local`,
        phoneEncrypted: "v1.k1.test.test.test",
        phoneHash: `${label}-${tag}`,
        addressEncrypted: "v1.k1.test.test.test",
        ...place,
        status: "approved",
        sellsServices: true,
      },
    });
    const product = await tx.product.create({
      data: { businessId: business.id, categoryId: productCategory.id, title: `Areatest kettle ${tag}`, slug: `${label}-kettle-${tag}`, basePriceKobo: 100_000n, status: "active" },
    });
    await tx.productVariant.create({ data: { productId: product.id, businessId: business.id, sku: `${label}-${tag}`, priceKobo: 100_000n, stockQty: 3, isDefault: true } });
    const service = await tx.service.create({
      data: {
        businessId: business.id,
        categoryId: serviceCategory.id,
        title: `Areatest plumbing ${tag}`,
        slug: `${label}-plumbing-${tag}`,
        basePriceKobo: 500_000n,
        durationMinutes: 60,
        locationMode: "on_site",
        serviceLgaIds,
        status: "active",
      },
    });
    return { businessId: business.id, productId: product.id, serviceId: service.id };
  });
}

beforeAll(async () => {
  const m = await moweOgun();
  const l = await lagosIkeja();
  // The Mowe provider still lists Ikeja from before providers were locked to their area.
  mowe = await createProvider("area-mowe", { ...m, city: "Mowe" }, [m.lgaId, l.lgaId]);
  lagos = await createProvider("area-lagos", { ...l, city: "Ikeja" }, [l.lgaId]);
});

afterAll(async () => {
  const businessId = { in: [mowe.businessId, lagos.businessId] };
  await owner.service.deleteMany({ where: { businessId } });
  await owner.product.deleteMany({ where: { businessId } });
  await owner.business.deleteMany({ where: { id: businessId } });
  await deleteUsers(...users);
});

const search = (q: Partial<Parameters<ReturnType<typeof searchProvider>["search"]>[0]>) =>
  searchProvider().search({ kind: "all", sort: "relevance", page: 1, pageSize: 50, q: `areatest ${tag}`, ...q });

describe("service area", () => {
  it("only lists shops, products and services based in Mowe", async () => {
    const r = await search({ kind: "products" });
    const ids = r.products.items.map((p) => p.id);
    expect(ids).toContain(mowe.productId);
    expect(ids).not.toContain(lagos.productId);

    const s = await search({ kind: "services" });
    expect(s.services.items.map((x) => x.id)).toContain(mowe.serviceId);
    expect(s.services.items.map((x) => x.id)).not.toContain(lagos.serviceId);

    const stores = await search({ q: `area-lagos ${tag}`, kind: "stores" });
    expect(stores.stores.items.map((x) => x.id)).not.toContain(lagos.businessId);
  });

  it("never shows a provider in another LGA or state, even one they listed before", async () => {
    const l = await lagosIkeja();
    const inIkeja = await search({ kind: "services", lgaId: l.lgaId });
    expect(inIkeja.services.items.map((x) => x.id)).not.toContain(mowe.serviceId);
    const inLagos = await search({ kind: "services", stateId: l.stateId });
    expect(inLagos.services.items.map((x) => x.id)).not.toContain(mowe.serviceId);
    const m = await moweOgun();
    const inMowe = await search({ kind: "services", lgaId: m.lgaId });
    expect(inMowe.services.items.map((x) => x.id)).toContain(mowe.serviceId);
  });

  it("saves a service as covering its business's own LGA only", async () => {
    const m = await moweOgun();
    const l = await lagosIkeja();
    const category = await owner.service.findUniqueOrThrow({ where: { id: mowe.serviceId }, select: { categoryId: true } });
    const data = serviceInputSchema.parse({
      title: `Areatest repair ${tag}`,
      descriptionHtml: "",
      categoryId: category.categoryId,
      pricingModel: "fixed",
      basePrice: "5000",
      durationMinutes: 60,
      locationMode: "on_site",
      serviceLgaIds: [l.lgaId],
      depositPercent: 0,
      requiresConfirmation: true,
      status: "draft",
      slug: "",
      packages: [],
      availability: [],
      blackouts: [],
      images: [],
    });
    const saved = await asSystem((tx) => saveService(tx, { businessId: mowe.businessId, data }));
    const row = await owner.service.findUniqueOrThrow({ where: { id: saved.serviceId }, select: { serviceLgaIds: true } });
    expect(row.serviceLgaIds).toEqual([m.lgaId]);
  });

  it("checks a place is inside the service area", async () => {
    const m = await moweOgun();
    const l = await lagosIkeja();
    await asSystem(async (tx) => {
      expect(await checkServiceArea(tx, { ...m, city: "MOWE" })).toEqual({ ok: true, city: "Mowe" });
      expect(await checkServiceArea(tx, { ...m, city: "Abeokuta" })).toMatchObject({ ok: false, fieldErrors: { city: expect.any(Array) } });
      expect(await checkServiceArea(tx, { ...l, city: "Ikeja" })).toMatchObject({ ok: false, fieldErrors: { lgaId: expect.any(Array) } });
      expect(await checkServiceArea(tx, { stateId: l.stateId, lgaId: m.lgaId, city: "Mowe" })).toMatchObject({ ok: false, fieldErrors: { lgaId: ["Not in this state"] } });
    });
  });
});
