import { randomUUID } from "node:crypto";
import { type Prisma, PrismaClient } from "@prisma/client";

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

/** A minimal placed order (no items), for tests that only need something to reference. */
export async function createBareOrder(userId: string | null) {
  return owner.order.create({
    data: {
      orderNumber: `TM-TEST-${randomUUID().slice(0, 12)}`,
      userId,
      contactEmail: `order-${randomUUID()}@test.townmart.local`,
      contactPhoneEncrypted: "v1.k1.test.test.test",
      customerName: "Test Person",
      shippingAddressSnapshot: {},
      subtotalKobo: 0n,
      discountKobo: 0n,
      deliveryKobo: 0n,
      serviceFeeKobo: 0n,
      vatKobo: 0n,
      totalKobo: 0n,
      paymentMethod: "fake",
      termsVersion: "test",
      refundPolicyVersion: "test",
      accessTokenHash: "test",
    },
  });
}

/**
 * Removes the money trail of test sellers and orders: ledger transactions
 * touching them (or their refunds and payouts), then disputes, refunds and
 * payouts. Run inside the owner's system-scope transaction, before deleting
 * payments, orders and businesses.
 */
export async function deleteMoneyTrail(tx: Prisma.TransactionClient, p: { businessIds: string[]; orderIds: string[] }) {
  const refunds = await tx.refund.findMany({ where: { OR: [{ orderId: { in: p.orderIds } }, { businessId: { in: p.businessIds } }] }, select: { id: true } });
  const payouts = await tx.payout.findMany({ where: { businessId: { in: p.businessIds } }, select: { id: true } });
  const sellerOrders = await tx.sellerOrder.findMany({ where: { OR: [{ orderId: { in: p.orderIds } }, { businessId: { in: p.businessIds } }] }, select: { id: true } });
  const refs = [...p.orderIds, ...refunds.map((r) => r.id), ...payouts.map((x) => x.id), ...sellerOrders.map((s) => s.id)];
  const byRef = await tx.ledgerTransaction.findMany({ where: { referenceId: { in: refs } }, select: { id: true } });
  const byBusiness = await tx.ledgerEntry.findMany({ where: { businessId: { in: p.businessIds } }, select: { transactionId: true } });
  const txIds = [...new Set([...byRef.map((t) => t.id), ...byBusiness.map((e) => e.transactionId)])];
  await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: txIds } } });
  await tx.ledgerTransaction.deleteMany({ where: { id: { in: txIds } } });
  await tx.ledgerAccount.deleteMany({ where: { ownerId: { in: p.businessIds } } });
  await tx.dispute.deleteMany({ where: { OR: [{ orderId: { in: p.orderIds } }, { businessId: { in: p.businessIds } }] } });
  await tx.refund.deleteMany({ where: { id: { in: refunds.map((r) => r.id) } } });
  await tx.payout.deleteMany({ where: { businessId: { in: p.businessIds } } });
}
