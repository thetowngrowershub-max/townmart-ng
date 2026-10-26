import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Prisma client connected as `townmart_app` (DATABASE_URL). This role cannot
 * bypass row-level security, so queries on RLS-protected tables must run inside
 * `withRls` (lib/db/rls.ts) or they will see no rows.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
