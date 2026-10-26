import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { sanitizeRichText } from "@/lib/sanitize";
import { imagePrefix } from "@/lib/storage/uploads";
import type { ServiceData } from "@/lib/validation/catalogue";
import { CatalogueError } from "./products";
import { listingSlug } from "./slug";
import { timeToMinutes } from "./units";

export type SaveServiceResult = { serviceId: string; slug: string; removedImageKeys: string[] };

/** Creates or updates a service with its packages, images, weekly availability and blackouts. */
export async function saveService(
  tx: Tx,
  params: { businessId: string; data: ServiceData; serviceId?: string },
): Promise<SaveServiceResult> {
  const { businessId, data } = params;

  const category = await tx.category.findUnique({ where: { id: data.categoryId }, select: { kind: true, isActive: true } });
  if (!category || category.kind !== "service" || !category.isActive) {
    throw new CatalogueError("Choose a service category", "categoryId");
  }
  const prefix = imagePrefix("service", businessId);
  if (data.images.some((i) => !i.key.startsWith(prefix))) throw new CatalogueError("One of the images isn't yours", "images");
  if (data.serviceLgaIds.length) {
    const found = await tx.lga.count({ where: { id: { in: data.serviceLgaIds } } });
    if (found !== new Set(data.serviceLgaIds).size) throw new CatalogueError("Unknown LGA selected", "serviceLgaIds");
  }

  const existing = params.serviceId
    ? await tx.service.findFirst({
        where: { id: params.serviceId, businessId, deletedAt: null },
        select: { id: true, slug: true, publishedAt: true, images: { select: { storageKey: true } } },
      })
    : null;
  if (params.serviceId && !existing) throw new CatalogueError("Service not found");

  // With packages, the headline price is the cheapest package.
  const basePriceKobo =
    data.pricingModel === "packages" && data.packages.length
      ? data.packages.map((p) => p.price).reduce((a, b) => (b < a ? b : a))
      : data.basePrice;
  const slug = data.slug || existing?.slug || listingSlug(data.title);

  const fields = {
    categoryId: data.categoryId,
    title: data.title,
    slug,
    descriptionHtml: sanitizeRichText(data.descriptionHtml),
    pricingModel: data.pricingModel,
    basePriceKobo,
    durationMinutes: data.durationMinutes,
    locationMode: data.locationMode,
    serviceLgaIds: [...new Set(data.serviceLgaIds)],
    radiusKm: data.radiusKm ?? null,
    depositPercent: data.depositPercent,
    requiresConfirmation: data.requiresConfirmation,
    status: data.status,
    metaTitle: data.metaTitle || null,
    metaDescription: data.metaDescription || null,
    publishedAt: data.status === "active" ? (existing?.publishedAt ?? new Date()) : (existing?.publishedAt ?? null),
  };

  let serviceId: string;
  try {
    serviceId = existing
      ? (await tx.service.update({ where: { id: existing.id }, data: fields, select: { id: true } })).id
      : (await tx.service.create({ data: { ...fields, businessId }, select: { id: true } })).id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new CatalogueError("That web address is already taken", "slug");
    }
    throw err;
  }

  await tx.servicePackage.deleteMany({ where: { serviceId } });
  if (data.pricingModel === "packages" && data.packages.length) {
    await tx.servicePackage.createMany({
      data: data.packages.map((p, position) => ({
        serviceId,
        businessId,
        name: p.name,
        description: p.description || null,
        priceKobo: p.price,
        durationMinutes: p.durationMinutes,
        position,
      })),
    });
  }

  await tx.serviceAvailability.deleteMany({ where: { serviceId } });
  if (data.availability.length) {
    await tx.serviceAvailability.createMany({
      data: data.availability.map((a) => ({
        serviceId,
        businessId,
        weekday: a.weekday,
        startMinute: timeToMinutes(a.start),
        endMinute: timeToMinutes(a.end),
        slotMinutes: a.slotMinutes,
        bufferMinutes: a.bufferMinutes,
        maxPerSlot: a.maxPerSlot,
      })),
    });
  }

  await tx.serviceBlackout.deleteMany({ where: { serviceId } });
  if (data.blackouts.length) {
    await tx.serviceBlackout.createMany({
      data: data.blackouts.map((b) => ({ serviceId, businessId, startsAt: b.startsAt, endsAt: b.endsAt, reason: b.reason || null })),
    });
  }

  await tx.serviceImage.deleteMany({ where: { serviceId } });
  if (data.images.length) {
    await tx.serviceImage.createMany({
      data: data.images.map((img, sortOrder) => ({
        serviceId,
        businessId,
        storageKey: img.key,
        altText: img.altText,
        width: img.width,
        height: img.height,
        sortOrder,
      })),
    });
  }
  const kept = new Set(data.images.map((i) => i.key));
  const removedImageKeys = (existing?.images ?? []).map((i) => i.storageKey).filter((k) => !kept.has(k));

  return { serviceId, slug, removedImageKeys };
}
