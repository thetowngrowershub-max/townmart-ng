import type { Prisma, Role } from "@prisma/client";
import type { Tx } from "@/lib/db";

const REDACT = /pass(word)?|token|secret|hash|encrypted|otp|code|cvv|card|bvn|nin|phone|address|line[12]/i;

/** Replaces sensitive values so audit rows never contain secrets or raw personal data. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT.test(k) ? "[redacted]" : redact(v)]),
    );
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export type AuditEntry = {
  actorUserId: string | null;
  actorRole?: Role | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipHash?: string | null;
};

/**
 * Appends to the immutable audit log inside the caller's transaction.
 * Uses createMany because it doesn't read the row back: ordinary users may
 * append audit rows but RLS doesn't let them SELECT them (INSERT … RETURNING would fail).
 */
export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.createMany({
    data: {
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before === undefined ? undefined : (redact(entry.before) as Prisma.InputJsonValue),
      after: entry.after === undefined ? undefined : (redact(entry.after) as Prisma.InputJsonValue),
      ipHash: entry.ipHash ?? null,
    },
  });
}
