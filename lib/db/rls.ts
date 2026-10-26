import type { Prisma } from "@prisma/client";
import { prisma } from "./client";

export type Tx = Prisma.TransactionClient;

/**
 * Who the database should treat as the actor for this transaction.
 *  - `user`:   an ordinary signed-in user (customer, seller, staff)
 *  - `admin`:  TownMart staff acting through the admin console (after an authz check)
 *  - `system`: worker jobs and platform internals with no end user
 */
export type RlsContext =
  | { scope?: "user"; userId: string | null; businessId?: string | null }
  | { scope: "admin"; userId: string; businessId?: string | null }
  | { scope: "system"; userId?: null; businessId?: null };

type TxOptions = { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number; maxWait?: number };

/**
 * Runs `fn` in a transaction with the RLS context set via `set_config(..., true)`.
 * The settings are transaction-local, so they never leak to another request on a
 * pooled connection (works with PgBouncer in transaction mode).
 *
 * Call this only after the app-layer `authz` check has passed; RLS is the second
 * line of defence, not the first.
 */
export async function withRls<T>(ctx: RlsContext, fn: (tx: Tx) => Promise<T>, options?: TxOptions): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config('app.current_user_id', ${ctx.userId ?? ""}, true),
             set_config('app.current_business_id', ${ctx.businessId ?? ""}, true),
             set_config('app.current_scope', ${ctx.scope ?? "user"}, true)`;
    return fn(tx);
  }, options);
}

/** Shorthand for worker jobs and other platform internals. */
export function withSystemContext<T>(fn: (tx: Tx) => Promise<T>, options?: TxOptions): Promise<T> {
  return withRls({ scope: "system" }, fn, options);
}
