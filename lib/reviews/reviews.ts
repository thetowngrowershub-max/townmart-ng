import type { Prisma } from "@prisma/client";
import { formatDate } from "@/lib/datetime";
import type { Tx } from "@/lib/db";
import { publicImageUrl } from "@/lib/storage";
import { customerOwner, imagePrefix } from "@/lib/storage/uploads";

export class ReviewError extends Error {}

/** "Adaeze Okafor" → "Adaeze O." Reviews never show a full name. */
export function shortName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "TownMart shopper";
  return parts.length === 1 ? parts[0]! : `${parts[0]} ${parts.at(-1)![0]!.toUpperCase()}.`;
}

export type Reviewable = {
  orderItemId: string;
  title: string;
  slug: string;
  imageKey: string | null;
  kind: "product" | "service";
  productId: string | null;
  serviceId: string | null;
  bookingId: string | null;
  businessId: string;
  businessName: string;
};

/**
 * The verified-purchase rule, in one place: an item can be reviewed by the
 * account that ordered it, once, after it was delivered (goods) or done
 * (bookings), on an order that was paid or paid on delivery and not cancelled.
 * Runs in the system scope; returns null when the rule isn't met.
 */
export async function findReviewable(tx: Tx, userId: string, orderItemId: string): Promise<Reviewable | null> {
  const item = await tx.orderItem.findUnique({
    where: { id: orderItemId },
    include: {
      review: { select: { id: true } },
      booking: { select: { id: true, status: true } },
      sellerOrder: { select: { status: true, business: { select: { name: true } }, order: { select: { userId: true, paymentStatus: true, cancelledAt: true } } } },
    },
  });
  if (!item || item.review) return null;
  const o = item.sellerOrder.order;
  if (o.userId !== userId || o.cancelledAt || o.paymentStatus === "unpaid" || o.paymentStatus === "failed") return null;
  const snap = item.snapshot as { title: string; slug: string; imageKey?: string | null };
  if (item.serviceId) {
    if (!item.booking || item.booking.status !== "completed") return null;
  } else {
    if (!item.productId || !["delivered", "completed"].includes(item.sellerOrder.status)) return null;
  }
  return {
    orderItemId: item.id,
    title: snap.title,
    slug: snap.slug,
    imageKey: snap.imageKey ?? null,
    kind: item.serviceId ? "service" : "product",
    productId: item.productId,
    serviceId: item.serviceId,
    bookingId: item.booking?.id ?? null,
    businessId: item.businessId,
    businessName: item.sellerOrder.business.name,
  };
}

/** Writes a verified review and refreshes the ratings it counts towards. System scope. */
export async function writeReview(tx: Tx, p: { userId: string; userName: string | null; orderItemId: string; rating: number; body: string; imageKeys: string[] }): Promise<{ id: string; target: Reviewable }> {
  const target = await findReviewable(tx, p.userId, p.orderItemId);
  if (!target) throw new ReviewError("You can review this once it has been delivered or done.");
  // Photos must be ones this customer just uploaded.
  const prefix = imagePrefix("review", customerOwner(p.userId));
  if (p.imageKeys.some((k) => !k.startsWith(prefix))) throw new ReviewError("Please upload your photos again.");
  const review = await tx.review.create({
    data: {
      targetType: target.kind,
      productId: target.productId,
      serviceId: target.serviceId,
      businessId: target.businessId,
      orderItemId: target.orderItemId,
      bookingId: target.bookingId,
      userId: p.userId,
      authorName: shortName(p.userName),
      rating: p.rating,
      body: p.body,
      imageKeys: p.imageKeys,
    },
  });
  await refreshRatings(tx, target);
  return { id: review.id, target };
}

export async function refreshRatings(tx: Tx, t: { businessId: string; productId: string | null; serviceId: string | null }): Promise<void> {
  await tx.$executeRaw`SELECT refresh_ratings(${t.businessId}::uuid, ${t.productId}::uuid, ${t.serviceId}::uuid)`;
}

export type ReviewView = {
  id: string;
  author: string;
  rating: number;
  body: string;
  date: string;
  images: string[];
  reply: { body: string; date: string } | null;
  reported: boolean;
};

export const toReviewView = (r: Prisma.ReviewGetPayload<object>): ReviewView => ({
  id: r.id,
  author: r.authorName,
  rating: r.rating,
  body: r.body,
  date: formatDate(r.createdAt),
  images: r.imageKeys.map(publicImageUrl),
  reply: r.sellerReply ? { body: r.sellerReply, date: formatDate(r.sellerRepliedAt ?? r.updatedAt) } : null,
  reported: r.status === "reported",
});

/** Published reviews of a listing, newest first, with a star breakdown. Guest RLS: hidden reviews never show. */
export async function listingReviews(tx: Tx, where: { productId: string } | { serviceId: string }, take = 10): Promise<{ reviews: ReviewView[]; total: number; breakdown: number[] }> {
  const base: Prisma.ReviewWhereInput = { ...where, status: { not: "hidden" } };
  const [rows, total, groups] = await Promise.all([
    tx.review.findMany({ where: base, orderBy: { createdAt: "desc" }, take }),
    tx.review.count({ where: base }),
    tx.review.groupBy({ by: ["rating"], where: base, _count: true }),
  ]);
  const breakdown = [5, 4, 3, 2, 1].map((star) => groups.find((g) => g.rating === star)?._count ?? 0);
  return { reviews: rows.map(toReviewView), total, breakdown };
}

export type WaitingItem = { orderItemId: string; title: string; imageUrl: string | null; businessName: string; orderNumber: string };

/**
 * Items the shopper can review now: the same rule as findReviewable, as one
 * query. Runs under the shopper's RLS, so only their own orders are seen.
 */
export async function waitingForReview(tx: Tx, userId: string, take = 20): Promise<WaitingItem[]> {
  const items = await tx.orderItem.findMany({
    where: {
      review: null,
      sellerOrder: { order: { userId, cancelledAt: null, paymentStatus: { notIn: ["unpaid", "failed"] } } },
      OR: [
        { productId: { not: null }, sellerOrder: { status: { in: ["delivered", "completed"] } } },
        { serviceId: { not: null }, booking: { status: "completed" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, snapshot: true, sellerOrder: { select: { orderNumber: true, business: { select: { name: true } } } } },
  });
  return items.map((i) => {
    const s = i.snapshot as { title: string; imageKey?: string | null };
    return { orderItemId: i.id, title: s.title, imageUrl: s.imageKey ? publicImageUrl(s.imageKey) : null, businessName: i.sellerOrder.business.name, orderNumber: i.sellerOrder.orderNumber };
  });
}

export type MyReview = ReviewView & { title: string; href: string; hidden: boolean };

/** The shopper's own reviews, including any hidden by moderation. Shopper RLS. */
export async function myReviews(tx: Tx, userId: string): Promise<MyReview[]> {
  const rows = await tx.review.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100, include: { product: { select: { title: true, slug: true } }, service: { select: { title: true, slug: true } } } });
  return rows.map((r) => ({
    ...toReviewView(r),
    title: r.product?.title ?? r.service?.title ?? "Removed listing",
    href: r.product ? `/p/${r.product.slug}` : r.service ? `/s/${r.service.slug}` : "#",
    hidden: r.status === "hidden",
  }));
}

export type SellerReview = ReviewView & { title: string; href: string; hidden: boolean };

/** A business's reviews for its dashboard, newest first; unanswered ones only if asked. Seller RLS. */
export async function sellerReviews(tx: Tx, businessId: string, unanswered: boolean, page: number, pageSize = 20): Promise<{ rows: SellerReview[]; total: number; avg: number; count: number; waiting: number }> {
  const where: Prisma.ReviewWhereInput = { businessId, ...(unanswered ? { sellerReply: null } : {}) };
  const [rows, total, biz, waiting] = await Promise.all([
    tx.review.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { product: { select: { title: true, slug: true } }, service: { select: { title: true, slug: true } } } }),
    tx.review.count({ where }),
    tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { ratingAvg: true, ratingCount: true } }),
    tx.review.count({ where: { businessId, sellerReply: null } }),
  ]);
  return {
    rows: rows.map((r) => ({
      ...toReviewView(r),
      title: r.product?.title ?? r.service?.title ?? "Removed listing",
      href: r.product ? `/p/${r.product.slug}` : r.service ? `/s/${r.service.slug}` : "#",
      hidden: r.status === "hidden",
    })),
    total,
    avg: Number(biz.ratingAvg),
    count: biz.ratingCount,
    waiting,
  };
}
