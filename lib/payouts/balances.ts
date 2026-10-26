import type { Tx } from "@/lib/db";

export type Balances = { escrowKobo: bigint; availableKobo: bigint };

/**
 * A seller's balances, computed from the ledger: escrow (held until orders
 * are delivered and the release period passes) and available (paid out to
 * the bank). Credits add, debits subtract. `before` gives the balances as
 * they stood at that moment (statements).
 */
export async function businessBalances(tx: Tx, businessId: string, before?: Date): Promise<Balances> {
  const rows = await tx.$queryRaw<{ type: string; balance: bigint }[]>`
    SELECT a.type::text AS type, coalesce(sum(e.credit_kobo - e.debit_kobo), 0)::bigint AS balance
      FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
     WHERE e.business_id = ${businessId}::uuid AND a.owner_type = 'business'
       AND (${before ?? null}::timestamptz IS NULL OR e.created_at < ${before ?? null}::timestamptz)
     GROUP BY 1`;
  return {
    escrowKobo: rows.find((b) => b.type === "escrow")?.balance ?? 0n,
    availableKobo: rows.find((b) => b.type === "available")?.balance ?? 0n,
  };
}
