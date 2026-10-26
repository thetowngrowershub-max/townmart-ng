"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { findSlot } from "@/lib/bookings/slots";
import { loadSchedule } from "@/lib/bookings/schedule";
import { withSystemContext } from "@/lib/db";
import { getCheckoutSettings } from "@/lib/settings";
import { addBookingSchema, addToCartSchema, cartItemIdSchema, couponCodeSchema, updateCartItemSchema } from "@/lib/validation/cart";
import { ensureCart, findCartOwner, withCart } from "./index";

const MAX_LINES = 100;

class CartError extends Error {}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof CartError) return { ok: false, error: err.message };
  logger.error({ err }, "cart action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

function refresh() {
  revalidatePath("/cart");
  revalidatePath("/checkout");
}

/** Checks the quantity against the product's rules. Stock is checked softly here and for real at checkout. */
function checkQty(p: { minOrderQty: Prisma.Decimal; allowFractionalQty: boolean; trackInventory: boolean; allowBackorder: boolean }, stock: Prisma.Decimal, qty: Prisma.Decimal) {
  if (!p.allowFractionalQty && !qty.isInteger()) throw new CartError("This item is sold in whole units.");
  if (qty.lessThan(p.minOrderQty)) throw new CartError(`The minimum order is ${p.minOrderQty.toString()}.`);
  if (p.trackInventory && !p.allowBackorder && qty.greaterThan(stock)) {
    throw new CartError(stock.lte(0) ? "Sorry, this is out of stock." : `Only ${stock.toString()} left in stock.`);
  }
}

async function guard() {
  const meta = await requestMeta();
  if (!(await rateLimit(`cart:${meta.ipHash}`, 120, 60)).allowed) throw new CartError("You're going a bit fast. Please wait a moment.");
}

export async function addToCartAction(input: { variantId: string; qty: string }): Promise<ActionResult<{ count: number }>> {
  const parsed = addToCartSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    await guard();
    const owner = await ensureCart();
    const count = await withCart(owner, async (tx) => {
      // Only live listings of approved sellers can be added (RLS hides the rest anyway).
      const v = await tx.productVariant.findFirst({
        where: { id: parsed.data.variantId, product: { status: "active", deletedAt: null, business: { status: "approved" } } },
        include: { product: { select: { minOrderQty: true, allowFractionalQty: true, trackInventory: true, allowBackorder: true } } },
      });
      if (!v) throw new CartError("This item is no longer available.");
      const existing = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: owner.cartId, variantId: v.id } } });
      const qty = new Prisma.Decimal(parsed.data.qty).plus(existing && !existing.savedForLater ? existing.qty : 0);
      checkQty(v.product, v.stockQty, qty);
      if (!existing && (await tx.cartItem.count({ where: { cartId: owner.cartId } })) >= MAX_LINES) throw new CartError("Your cart is full. Check out or remove something first.");
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: owner.cartId, variantId: v.id } },
        update: { qty, savedForLater: false },
        create: { cartId: owner.cartId, variantId: v.id, businessId: v.businessId, qty },
      });
      return tx.cartItem.count({ where: { cartId: owner.cartId, savedForLater: false } });
    });
    refresh();
    return { ok: true, data: { count }, message: "Added to your cart." };
  } catch (err) {
    return failure(err);
  }
}

/**
 * Adds a booking (a service at a chosen time) to the cart. The time is
 * checked against the provider's hours and bookings now, again at checkout,
 * and claimed for real when the order is placed.
 */
export async function addBookingToCartAction(input: { serviceId: string; packageId?: string | null; startsAt: string; atProvider?: boolean }): Promise<ActionResult<{ count: number }>> {
  const parsed = addBookingSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { serviceId, packageId, atProvider } = parsed.data;
  const startsAt = new Date(parsed.data.startsAt);
  try {
    await guard();
    const owner = await ensureCart();
    const count = await withCart(owner, async (tx) => {
      const service = await tx.service.findFirst({
        where: { id: serviceId, status: "active", deletedAt: null, business: { status: "approved" } },
        include: { packages: { select: { id: true, durationMinutes: true } } },
      });
      if (!service) throw new CartError("This service is no longer available.");
      const pkg = packageId ? service.packages.find((p) => p.id === packageId) : undefined;
      if (packageId && !pkg) throw new CartError("Choose one of the packages offered.");
      if (!pkg && service.pricingModel === "packages" && service.packages.length) throw new CartError("Choose a package first.");
      const durationMinutes = pkg?.durationMinutes ?? service.durationMinutes;

      // Other bookings are private, so the time is checked in the system scope.
      const open = await withSystemContext(async (sys) => {
        const settings = await getCheckoutSettings(sys);
        const now = new Date();
        const earliest = new Date(now.getTime() + settings.bookingLeadMinutes * 60_000);
        if (startsAt.getTime() > now.getTime() + (settings.bookingDaysAhead + 1) * 86_400_000) return false;
        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
        const schedule = await loadSchedule(sys, service.id, new Date(startsAt.getTime() - 86_400_000), new Date(endsAt.getTime() + 86_400_000));
        const slot = findSlot({ ...schedule, durationMinutes, earliest }, startsAt);
        return slot !== null && slot.remaining > 0;
      });
      if (!open) throw new CartError("That time isn't available any more. Please pick another.");

      const existing = await tx.cartItem.findFirst({ where: { cartId: owner.cartId, serviceId: service.id, bookingStartsAt: startsAt }, select: { id: true } });
      if (existing) throw new CartError("That booking is already in your cart.");
      if ((await tx.cartItem.count({ where: { cartId: owner.cartId } })) >= MAX_LINES) throw new CartError("Your cart is full. Check out or remove something first.");
      await tx.cartItem.create({
        data: {
          cartId: owner.cartId,
          serviceId: service.id,
          packageId: pkg?.id ?? null,
          bookingStartsAt: startsAt,
          atProvider: service.locationMode === "at_provider" || (service.locationMode === "both" && atProvider),
          businessId: service.businessId,
          qty: new Prisma.Decimal(1),
        },
      });
      return tx.cartItem.count({ where: { cartId: owner.cartId, savedForLater: false } });
    });
    refresh();
    return { ok: true, data: { count }, message: "Booking added to your cart." };
  } catch (err) {
    return failure(err);
  }
}

async function onItem<T>(itemId: string, fn: (tx: Prisma.TransactionClient, item: { id: string; cartId: string }) => Promise<T>): Promise<T> {
  const owner = await findCartOwner();
  if (!owner.cartId) throw new CartError("Your cart is empty.");
  return withCart(owner, async (tx) => {
    // RLS limits this to the shopper's own cart.
    const item = await tx.cartItem.findFirst({ where: { id: itemId, cartId: owner.cartId! }, select: { id: true, cartId: true } });
    if (!item) throw new CartError("That item isn't in your cart any more.");
    return fn(tx, item);
  });
}

export async function updateCartItemAction(input: { itemId: string; qty: string }): Promise<ActionResult> {
  const parsed = updateCartItemSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    await guard();
    await onItem(parsed.data.itemId, async (tx, item) => {
      const full = await tx.cartItem.findUniqueOrThrow({
        where: { id: item.id },
        include: { variant: { include: { product: { select: { minOrderQty: true, allowFractionalQty: true, trackInventory: true, allowBackorder: true } } } } },
      });
      if (!full.variant) throw new CartError("A booking is for one appointment. Add another time to book again.");
      const qty = new Prisma.Decimal(parsed.data.qty);
      checkQty(full.variant.product, full.variant.stockQty, qty);
      await tx.cartItem.update({ where: { id: item.id }, data: { qty } });
    });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function removeCartItemAction(input: { itemId: string }): Promise<ActionResult> {
  const parsed = cartItemIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    await onItem(parsed.data.itemId, (tx, item) => tx.cartItem.delete({ where: { id: item.id } }));
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function saveForLaterAction(input: { itemId: string; saved: boolean }): Promise<ActionResult> {
  const parsed = cartItemIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    await onItem(parsed.data.itemId, (tx, item) => tx.cartItem.update({ where: { id: item.id }, data: { savedForLater: input.saved === true } }));
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function applyCouponAction(input: { code: string }): Promise<ActionResult> {
  const parsed = couponCodeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const meta = await requestMeta();
    // Guessing codes is the abuse to stop here.
    if (!(await rateLimit(`coupon:${meta.ipHash}`, 10, 600)).allowed) throw new CartError("Too many codes tried. Please wait a few minutes.");
    const owner = await ensureCart();
    await withCart(owner, (tx) => tx.cart.update({ where: { id: owner.cartId }, data: { couponCode: parsed.data.code } }));
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function removeCouponAction(): Promise<ActionResult> {
  try {
    const owner = await findCartOwner();
    if (owner.cartId) await withCart(owner, (tx) => tx.cart.update({ where: { id: owner.cartId! }, data: { couponCode: null } }));
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}
