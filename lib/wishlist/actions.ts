"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/validation/form-result";

const targetSchema = z.union([z.object({ productId: z.uuid() }).strict(), z.object({ serviceId: z.uuid() }).strict()]);

/** Adds a listing to the shopper's wishlist, or takes it off. Shopper RLS: only their own rows. */
export async function toggleWishlistAction(input: { productId: string } | { serviceId: string }): Promise<ActionResult<{ saved: boolean }>> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something went wrong. Please try again." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to save things for later." };
  try {
    const saved = await withRls({ userId: user.id }, async (tx) => {
      const where = { userId: user.id, ...parsed.data };
      const { count } = await tx.wishlistItem.deleteMany({ where });
      if (count > 0) return false;
      await tx.wishlistItem.create({ data: where });
      return true;
    });
    revalidatePath("/account/wishlist");
    return { ok: true, data: { saved }, message: saved ? "Saved to your wishlist." : "Removed from your wishlist." };
  } catch (err) {
    // A double click can race the unique index; the item is saved either way.
    if (err instanceof Error && /Unique constraint/.test(err.message)) return { ok: true, data: { saved: true } };
    logger.error({ err }, "wishlist toggle failed");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
