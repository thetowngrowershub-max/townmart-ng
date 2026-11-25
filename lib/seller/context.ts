import "server-only";
import type { Business, BusinessStatus } from "@prisma/client";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { can, type BusinessMembership } from "@/lib/authz";
import { withRls, type Tx } from "@/lib/db";

export type SellerBusiness = Pick<
  Business,
  "id" | "name" | "slug" | "type" | "status" | "sellsProducts" | "sellsServices" | "rejectionReason" | "logoKey"
>;

export type SellerContext = {
  user: CurrentUser & { businesses: BusinessMembership[] };
  business: SellerBusiness;
  membership: BusinessMembership;
};

const businessSelect = {
  id: true,
  name: true,
  slug: true,
  type: true,
  status: true,
  sellsProducts: true,
  sellsServices: true,
  rejectionReason: true,
  logoKey: true,
} as const;

/**
 * The signed-in user's seller business (owned, else the first accepted staff
 * membership), or null. A user owns at most one business; one business can
 * sell both products and services.
 */
export const getSellerContext = cache(async (): Promise<SellerContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const owned = await withRls({ userId: user.id }, (tx) =>
    tx.business.findFirst({ where: { ownerUserId: user.id }, select: businessSelect }),
  );
  if (owned) {
    const membership: BusinessMembership = { id: owned.id, role: "owner" };
    return { user: { ...user, businesses: [membership] }, business: owned, membership };
  }

  const staff = await withRls({ userId: user.id }, (tx) =>
    tx.businessStaff.findFirst({ where: { userId: user.id, acceptedAt: { not: null } }, select: { businessId: true, permissions: true } }),
  );
  if (!staff) return null;
  const business = await withRls({ userId: user.id, businessId: staff.businessId }, (tx) =>
    tx.business.findUnique({ where: { id: staff.businessId }, select: businessSelect }),
  );
  if (!business) return null;
  const membership: BusinessMembership = {
    id: business.id,
    role: "staff",
    permissions: (staff.permissions ?? {}) as Record<string, boolean>,
  };
  return { user: { ...user, businesses: [membership] }, business, membership };
});

/** For seller pages: redirects to sign-in or onboarding when there's no business yet. */
export async function requireSellerContext(nextPath: string): Promise<SellerContext> {
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`);
  const ctx = await getSellerContext();
  if (!ctx) redirect("/sell/onboarding");
  return ctx;
}

/** For seller pages that need a business permission: 403 for staff without it. */
export async function requireSellerPage(
  nextPath: string,
  permission: "listing.read" | "listing.write" | "import.manage" | "store.manage" | "promotion.manage" | "order.read" | "order.manage" | "booking.manage" | "review.manage" | "payout.manage" | "staff.manage" | "question.answer",
): Promise<SellerContext> {
  const ctx = await requireSellerContext(nextPath);
  if (!can(ctx.user, permission, { businessId: ctx.business.id })) forbidden();
  return ctx;
}

/** Runs `fn` with RLS scoped to the seller's business. Call after the authz check. */
export function withSellerRls<T>(ctx: SellerContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRls({ userId: ctx.user.id, businessId: ctx.business.id }, fn);
}

export const LIVE_STATUSES: readonly BusinessStatus[] = ["approved"];
