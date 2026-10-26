import "server-only";
import { cache } from "react";
import { withRls } from "@/lib/db";

/** Public reads run as a guest so the storefront shows exactly what anyone can see. */
const asGuest = <T,>(fn: Parameters<typeof withRls<T>>[1]) => withRls({ userId: null }, fn);

const live = { status: "active", deletedAt: null, business: { status: "approved" } } as const;

export const getPublicProduct = cache((slug: string) =>
  asGuest((tx) =>
    tx.product.findFirst({
      where: { slug, ...live },
      include: {
        images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }] },
        options: { orderBy: { position: "asc" } },
        variants: { orderBy: { position: "asc" } },
        category: { select: { name: true, slug: true, parent: { select: { name: true, slug: true } } } },
        business: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoKey: true,
            city: true,
            ratingAvg: true,
            ratingCount: true,
            createdAt: true,
            state: { select: { name: true } },
            policy: { select: { returnWindowDays: true, deliveryOptions: true, acceptsPayOnDelivery: true } },
          },
        },
      },
    }),
  ),
);

export const getRelatedProducts = (productId: string, categoryId: string) =>
  asGuest((tx) =>
    tx.product.findMany({
      where: { ...live, categoryId, id: { not: productId } },
      orderBy: [{ ratingCount: "desc" }, { createdAt: "desc" }],
      take: 4,
      select: {
        id: true,
        slug: true,
        title: true,
        basePriceKobo: true,
        compareAtPriceKobo: true,
        unit: true,
        ratingAvg: true,
        ratingCount: true,
        trackInventory: true,
        allowBackorder: true,
        images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], take: 1, select: { storageKey: true, altText: true } },
        variants: { select: { stockQty: true } },
        business: { select: { name: true, slug: true, city: true, state: { select: { name: true } } } },
      },
    }),
  );

export const getPublicService = cache((slug: string) =>
  asGuest((tx) =>
    tx.service.findFirst({
      where: { slug, ...live },
      include: {
        images: { orderBy: { sortOrder: "asc" } },
        packages: { orderBy: { position: "asc" } },
        availability: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] },
        blackouts: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, take: 10 },
        category: { select: { name: true, slug: true, parent: { select: { name: true, slug: true } } } },
        business: {
          select: {
            name: true,
            slug: true,
            logoKey: true,
            city: true,
            lgaId: true,
            ratingAvg: true,
            ratingCount: true,
            createdAt: true,
            state: { select: { name: true } },
            lga: { select: { name: true } },
          },
        },
      },
    }),
  ),
);

export const getLgaNames = (ids: number[]) =>
  ids.length
    ? asGuest((tx) => tx.lga.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" }, select: { id: true, name: true, state: { select: { name: true } } } }))
    : Promise.resolve([]);

export const getPublicStore = cache((slug: string) =>
  asGuest((tx) =>
    tx.business.findFirst({
      where: { slug, status: "approved" },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        description: true,
        logoKey: true,
        bannerKey: true,
        city: true,
        ratingAvg: true,
        ratingCount: true,
        createdAt: true,
        state: { select: { name: true } },
        lga: { select: { name: true } },
        policy: { select: { returnWindowDays: true, deliveryOptions: true, acceptsPayOnDelivery: true } },
      },
    }),
  ),
);
