import { writeAudit } from "@/lib/audit";
import { tokenIdentifier } from "@/lib/auth/constants";
import { consumeToken } from "@/lib/auth/tokens";
import { withSystemContext } from "@/lib/db";
import { confirmDataRequest } from "./requests";

/** The link in the confirmation email: the request joins the queue and its deadline starts. */
export async function confirmPublicRequest(id: string, token: string): Promise<{ reference: string; dueAt: Date | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !token) return null;
  if (!(await consumeToken(tokenIdentifier.dataRequest(id), token))) return null;
  const r = await withSystemContext(async (tx) => {
    const r = await confirmDataRequest(tx, id);
    await writeAudit(tx, { actorUserId: null, action: "dsr.confirmed", entityType: "data_subject_request", entityId: id, after: { reference: r.reference } });
    return r;
  });
  return { reference: r.reference, dueAt: r.dueAt };
}
