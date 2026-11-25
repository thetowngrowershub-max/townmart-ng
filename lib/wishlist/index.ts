import { withRls } from "@/lib/db";

/** Whether the shopper has saved this listing. Shopper RLS. */
export async function isSaved(userId: string | undefined, target: { productId: string } | { serviceId: string }): Promise<boolean> {
  if (!userId) return false;
  return withRls({ userId }, async (tx) => (await tx.wishlistItem.count({ where: { userId, ...target } })) > 0);
}
