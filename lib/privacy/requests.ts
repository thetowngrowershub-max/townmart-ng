import type { DsrStatus, DsrType } from "@prisma/client";
import { daysFrom, getRetention } from "@/lib/compliance/retention";
import type { Tx } from "@/lib/db";

export { DSR_STATUS_LABELS, DSR_TYPE_LABELS } from "./labels";

/**
 * Data subject requests (NDPA 2023 Part VI). Each one gets a reference and a
 * deadline (the "data request deadline" retention setting, 30 days by
 * default) once the requester is known: straight away from the Privacy
 * Centre, after the email check from the public form.
 */

export const OPEN_STATUSES: DsrStatus[] = ["open", "in_progress"];

export class DataRequestError extends Error {}

export async function createDataRequest(
  tx: Tx,
  p: { type: DsrType; userId: string | null; email: string; name?: string | null; details?: string | null; channel: "privacy_centre" | "public_form"; ipHash?: string | null; verified: boolean; dueAt?: Date },
) {
  const now = new Date();
  const reference = (await tx.$queryRaw<{ r: string }[]>`SELECT next_dsr_reference() AS r`)[0]!.r;
  const dueAt = p.verified ? (p.dueAt ?? daysFrom((await getRetention(tx)).dsr_response, now)) : null;
  return tx.dataSubjectRequest.create({
    data: {
      reference,
      type: p.type,
      status: p.verified ? "open" : "unverified",
      userId: p.userId,
      email: p.email,
      name: p.name ?? null,
      details: p.details?.trim() || null,
      channel: p.channel,
      verifiedAt: p.verified ? now : null,
      dueAt,
      ipHash: p.ipHash ?? null,
    },
  });
}

/** The requester confirmed their email: the request joins the queue and the deadline starts. */
export async function confirmDataRequest(tx: Tx, id: string) {
  const r = await tx.dataSubjectRequest.findUnique({ where: { id } });
  if (!r) throw new DataRequestError("We couldn't find that request.");
  if (r.status !== "unverified") return r;
  const now = new Date();
  return tx.dataSubjectRequest.update({ where: { id }, data: { status: "open", verifiedAt: now, dueAt: daysFrom((await getRetention(tx)).dsr_response, now) } });
}

/** Days left to answer (negative when overdue), counted in whole days. */
export function deadline(dueAt: Date | null, now = new Date()): { daysLeft: number; overdue: boolean; label: string } | null {
  if (!dueAt) return null;
  const ms = dueAt.getTime() - now.getTime();
  const daysLeft = Math.ceil(ms / 86_400_000);
  const overdue = ms < 0;
  const late = Math.ceil(-ms / 86_400_000);
  const label = overdue ? `${late} day${late === 1 ? "" : "s"} overdue` : daysLeft <= 1 ? "Due within a day" : `${daysLeft} days left`;
  return { daysLeft, overdue, label };
}
