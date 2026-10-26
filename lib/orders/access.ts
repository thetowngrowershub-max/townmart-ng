import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { sha256 } from "@/lib/crypto";
import { withSystemContext } from "@/lib/db";

/**
 * Finds an order the current visitor may open: by the secret in a guest's
 * order link, or as the signed-in shopper who placed it. Looks the order up
 * in the system scope, so this check is the gate; a miss and a refusal look
 * the same.
 */
export async function findViewableOrder(orderNumber: string, token: string | null | undefined) {
  const user = await getCurrentUser();
  const order = await withSystemContext((tx) => tx.order.findUnique({ where: { orderNumber }, select: { id: true, userId: true, accessTokenHash: true } }));
  if (!order) return null;
  const tokenOk = typeof token === "string" && token.length > 0 && sha256(token) === order.accessTokenHash;
  const ownerOk = user !== null && order.userId === user.id;
  return tokenOk || ownerOk ? { id: order.id, userId: order.userId } : null;
}
