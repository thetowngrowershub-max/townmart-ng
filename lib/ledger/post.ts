import type { Tx } from "@/lib/db";
import { assertBalanced, type AccountRef, type Posting } from "./entries";

function accountKey(a: AccountRef) {
  return {
    ownerType: a.ownerType,
    ownerId: a.ownerType === "business" ? a.businessId : null,
    ownerKey: a.ownerType === "business" ? a.businessId : a.ownerType === "provider_clearing" ? a.provider : "",
    type: a.type,
  } as const;
}

async function accountId(tx: Tx, a: AccountRef): Promise<string> {
  const k = accountKey(a);
  // NULLS NOT DISTINCT unique index: one row per owner and type.
  // Accounts are never updated (the app can't), so insert if missing, then read.
  await tx.$executeRaw`
    INSERT INTO ledger_accounts (owner_type, owner_id, owner_key, type)
    VALUES (${k.ownerType}::ledger_owner_type, ${k.ownerId}::uuid, ${k.ownerKey}, ${k.type}::ledger_account_type)
    ON CONFLICT (owner_type, owner_key, type) DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_accounts
     WHERE owner_type = ${k.ownerType}::ledger_owner_type AND owner_key = ${k.ownerKey} AND type = ${k.type}::ledger_account_type`;
  return rows[0]!.id;
}

/**
 * Writes one ledger transaction in the caller's (system-scope) transaction.
 * Returns false, writing nothing, if this kind of transaction already exists
 * for the reference: postings are idempotent.
 */
export async function postLedgerTransaction(
  tx: Tx,
  params: { kind: string; referenceType: string; referenceId: string; memo?: string; postings: readonly Posting[] },
): Promise<boolean> {
  assertBalanced(params.postings);
  const created = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO ledger_transactions (kind, reference_type, reference_id, memo)
    VALUES (${params.kind}, ${params.referenceType}, ${params.referenceId}::uuid, ${params.memo ?? null})
    ON CONFLICT (kind, reference_type, reference_id) DO NOTHING
    RETURNING id`;
  const transactionId = created[0]?.id;
  if (!transactionId) return false;
  for (const p of params.postings) {
    await tx.ledgerEntry.create({
      data: {
        transactionId,
        accountId: await accountId(tx, p.account),
        debitKobo: p.debitKobo,
        creditKobo: p.creditKobo,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
      },
    });
  }
  return true;
}
