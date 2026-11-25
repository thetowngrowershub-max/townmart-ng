import { csvCell } from "@/lib/csv";
import type { Tx } from "@/lib/db";
import { formatDateTime } from "@/lib/datetime";
import { koboToNairaString } from "@/lib/money";
import { businessBalances, type Balances } from "./balances";

/**
 * Monthly seller statements, built from the ledger: every movement on the
 * seller's escrow and available balances, with the balances at the start and
 * end of the month (Lagos time).
 */

export const KIND_LABELS: Record<string, string> = {
  payment_captured: "Sale (held until delivery)",
  escrow_released: "Released to your balance",
  pod_settled: "Commission on a pay-on-delivery order",
  refund_approved: "Refund to a customer",
  payout: "Payout to your bank",
  payout_returned: "Payout returned",
};

export type StatementLine = {
  at: Date;
  kind: string;
  label: string;
  memo: string | null;
  escrowKobo: bigint;
  availableKobo: bigint;
  /** Available balance after this line. */
  balanceKobo: bigint;
};

export type Statement = {
  month: string;
  from: Date;
  to: Date;
  opening: Balances;
  closing: Balances;
  lines: StatementLine[];
  totals: { salesKobo: bigint; refundsKobo: bigint; payoutsKobo: bigint; commissionKobo: bigint };
};

/** "2026-10" → the month's start and end instants in Lagos time (UTC+1, no daylight saving). */
export function monthRange(month: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const from = new Date(`${m[1]}-${m[2]}-01T00:00:00+01:00`);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  return { from, to: new Date(`${next}-01T00:00:00+01:00`) };
}

/** The Lagos month a moment falls in: "2026-10". */
export const lagosMonth = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 7);

export async function buildStatement(tx: Tx, businessId: string, month: string): Promise<Statement | null> {
  const range = monthRange(month);
  if (!range) return null;
  const opening = await businessBalances(tx, businessId, range.from);
  const rows = await tx.$queryRaw<{ transaction_id: string; created_at: Date; kind: string; memo: string | null; type: string; delta: bigint }[]>`
    SELECT t.id AS transaction_id, t.created_at, t.kind, t.memo, a.type::text AS type, sum(e.credit_kobo - e.debit_kobo)::bigint AS delta
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      JOIN ledger_transactions t ON t.id = e.transaction_id
     WHERE e.business_id = ${businessId}::uuid AND a.owner_type = 'business'
       AND e.created_at >= ${range.from} AND e.created_at < ${range.to}
     GROUP BY t.id, t.created_at, t.kind, t.memo, a.type
     ORDER BY t.created_at, t.id`;
  const byTx = new Map<string, StatementLine>();
  for (const r of rows) {
    const line = byTx.get(r.transaction_id) ?? { at: r.created_at, kind: r.kind, label: KIND_LABELS[r.kind] ?? r.kind, memo: r.memo, escrowKobo: 0n, availableKobo: 0n, balanceKobo: 0n };
    if (r.type === "escrow") line.escrowKobo += r.delta;
    else line.availableKobo += r.delta;
    byTx.set(r.transaction_id, line);
  }
  let balance = opening.availableKobo;
  let escrow = opening.escrowKobo;
  const lines = [...byTx.values()];
  for (const l of lines) {
    balance += l.availableKobo;
    escrow += l.escrowKobo;
    l.balanceKobo = balance;
  }
  const sum = (kind: string, f: (l: StatementLine) => bigint) => lines.filter((l) => l.kind === kind).reduce((a, l) => a + f(l), 0n);
  const commission = await tx.$queryRaw<{ kobo: bigint | null }[]>`
    SELECT sum(so.commission_kobo)::bigint AS kobo FROM seller_orders so
     WHERE so.business_id = ${businessId}::uuid AND so.escrow_released_at >= ${range.from} AND so.escrow_released_at < ${range.to}`;
  return {
    month,
    ...range,
    opening,
    closing: { escrowKobo: escrow, availableKobo: balance },
    lines,
    totals: {
      salesKobo: sum("payment_captured", (l) => l.escrowKobo),
      refundsKobo: -sum("refund_approved", (l) => l.escrowKobo + l.availableKobo),
      payoutsKobo: -sum("payout", (l) => l.availableKobo) - sum("payout_returned", (l) => l.availableKobo),
      commissionKobo: commission[0]?.kobo ?? 0n,
    },
  };
}

/** The statement as CSV, amounts in naira. Text cells starting with = + - @ are prefixed so spreadsheets don't run them. */
export function statementCsv(s: Statement, businessName: string): string {
  const rows: string[][] = [
    ["TownMart statement", businessName],
    ["Month", s.month],
    ["Opening available balance", koboToNairaString(s.opening.availableKobo)],
    ["Opening held in escrow", koboToNairaString(s.opening.escrowKobo)],
    [],
    ["Date (Lagos)", "Type", "Details", "Held in escrow (NGN)", "Available (NGN)", "Available balance (NGN)"],
    ...s.lines.map((l) => [formatDateTime(l.at), l.label, l.memo ?? "", koboToNairaString(l.escrowKobo), koboToNairaString(l.availableKobo), koboToNairaString(l.balanceKobo)]),
    [],
    ["Closing available balance", koboToNairaString(s.closing.availableKobo)],
    ["Closing held in escrow", koboToNairaString(s.closing.escrowKobo)],
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
