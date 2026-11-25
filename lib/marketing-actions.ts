"use server";

import { withSystemContext } from "@/lib/db";
import { unsubscribe, verifyUnsubscribe } from "@/lib/marketing";
import type { ActionResult } from "@/lib/validation/form-result";

export async function unsubscribeAction(input: { e: string; t: string }): Promise<ActionResult> {
  const email = verifyUnsubscribe(input.e, input.t);
  if (!email) return { ok: false, error: "This unsubscribe link isn't valid. Use the link from your latest email." };
  await withSystemContext((tx) => unsubscribe(tx, email, "link"));
  return { ok: true };
}
