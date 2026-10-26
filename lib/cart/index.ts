import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { lookupHash, randomToken } from "@/lib/crypto";
import { withRls, withSystemContext, type Tx } from "@/lib/db";

export const CART_COOKIE = "tm_cart";
const CART_DAYS = 30;

export type CartOwner = { userId: string | null; cartId: string | null };

const tokenHash = (token: string) => lookupHash(token, "cart");
const expiry = () => new Date(Date.now() + CART_DAYS * 86_400_000);

async function guestCartId(): Promise<string | null> {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  // Looking a cart up by its token hash is the one read that can't be scoped
  // to the cart yet; it returns only the id.
  const cart = await withSystemContext((tx) => tx.cart.findUnique({ where: { guestTokenHash: tokenHash(token) }, select: { id: true, userId: true } }));
  return cart && !cart.userId ? cart.id : null;
}

/** Whose cart this request is about. Read-only: safe in pages. */
export async function findCartOwner(): Promise<CartOwner> {
  const user = await getCurrentUser();
  if (user) {
    const cart = await withRls({ userId: user.id }, (tx) => tx.cart.findUnique({ where: { userId: user.id }, select: { id: true } }));
    return { userId: user.id, cartId: cart?.id ?? null };
  }
  return { userId: null, cartId: await guestCartId() };
}

/** Runs `fn` scoped to the owner's cart under RLS. */
export function withCart<T>(owner: CartOwner, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRls({ userId: owner.userId, cartId: owner.cartId }, fn);
}

/** Finds or creates the cart. Server Actions only (it may set the guest cookie). */
export async function ensureCart(): Promise<CartOwner & { cartId: string }> {
  const owner = await findCartOwner();
  if (owner.cartId) return { ...owner, cartId: owner.cartId };
  if (owner.userId) {
    const userId = owner.userId;
    const cart = await withRls({ userId }, (tx) => tx.cart.upsert({ where: { userId }, update: {}, create: { userId, expiresAt: expiry() }, select: { id: true } }));
    return { userId, cartId: cart.id };
  }
  const token = randomToken(32);
  const id = randomUUID();
  await withRls({ userId: null, cartId: id }, (tx) => tx.cart.create({ data: { id, guestTokenHash: tokenHash(token), expiresAt: expiry() }, select: { id: true } }));
  (await cookies()).set(CART_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: CART_DAYS * 86_400 });
  return { userId: null, cartId: id };
}

/**
 * After sign-in: moves the guest cart's items into the user's cart (keeping
 * the larger quantity of anything in both) and forgets the guest cart.
 */
export async function mergeGuestCart(userId: string): Promise<void> {
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;
  if (!token) return;
  await withSystemContext(async (tx) => {
    const guest = await tx.cart.findUnique({ where: { guestTokenHash: tokenHash(token) }, include: { items: true } });
    if (!guest || guest.userId) return;
    const mine = await tx.cart.upsert({ where: { userId }, update: {}, create: { userId, expiresAt: expiry() }, include: { items: true } });
    for (const item of guest.items) {
      const existing = item.variantId
        ? mine.items.find((i) => i.variantId === item.variantId)
        : mine.items.find((i) => i.serviceId === item.serviceId && i.bookingStartsAt?.getTime() === item.bookingStartsAt?.getTime());
      if (!existing) {
        await tx.cartItem.create({
          data: {
            cartId: mine.id,
            variantId: item.variantId,
            serviceId: item.serviceId,
            packageId: item.packageId,
            bookingStartsAt: item.bookingStartsAt,
            atProvider: item.atProvider,
            businessId: item.businessId,
            qty: item.qty,
            savedForLater: item.savedForLater,
          },
        });
      } else if (item.qty.greaterThan(existing.qty)) {
        await tx.cartItem.update({ where: { id: existing.id }, data: { qty: item.qty } });
      }
    }
    if (guest.couponCode && !mine.couponCode) await tx.cart.update({ where: { id: mine.id }, data: { couponCode: guest.couponCode } });
    await tx.cart.delete({ where: { id: guest.id } });
  });
  jar.delete(CART_COOKIE);
}

/** Number of items (not units) in the cart, for the header badge. */
export async function cartCount(): Promise<number> {
  const owner = await findCartOwner();
  if (!owner.cartId) return 0;
  return withCart(owner, (tx) => tx.cartItem.count({ where: { cartId: owner.cartId!, savedForLater: false } }));
}
