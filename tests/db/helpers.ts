import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * DB tests run against a migrated database (pnpm db:deploy) with two clients:
 *  - `owner`: townmart_migrator, which owns the tables and bypasses RLS — for fixtures only
 *  - the app client from lib/db: townmart_app, subject to RLS — the thing under test
 */
export const owner = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });

export async function createUser(label: string) {
  return owner.user.create({
    data: { email: `${label}-${randomUUID()}@test.townmart.local`, name: label, roles: { create: [{ role: "customer" }] } },
  });
}

export async function lagosIkeja() {
  const state = await owner.state.findUniqueOrThrow({ where: { code: "LA" } });
  const lga = await owner.lga.findFirstOrThrow({ where: { stateId: state.id, slug: "ikeja" } });
  return { stateId: state.id, lgaId: lga.id };
}

export async function createAddress(userId: string, label = "Home") {
  const { stateId, lgaId } = await lagosIkeja();
  return owner.address.create({
    data: {
      userId,
      label,
      recipientName: "Test Person",
      phoneEncrypted: "v1.k1.test.test.test",
      line1Encrypted: "v1.k1.test.test.test",
      city: "Ikeja",
      stateId,
      lgaId,
    },
  });
}

export async function deleteUsers(...ids: string[]) {
  await owner.user.deleteMany({ where: { id: { in: ids } } });
}
