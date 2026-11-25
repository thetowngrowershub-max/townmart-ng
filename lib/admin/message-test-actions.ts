"use server";

import { revalidatePath } from "next/cache";
import { adminContext, adminFailure, AdminError } from "@/lib/admin/context";
import { env } from "@/lib/env";
import { sendTracked } from "@/lib/notifications/delivery-log";
import { emailProvider } from "@/lib/notifications/email";
import { smsProvider } from "@/lib/notifications/sms";
import { maskPhone } from "@/lib/phone";
import { rateLimit } from "@/lib/rate-limit";
import { scrub } from "@/lib/test-mode/page-errors";
import { phoneOnlySchema } from "@/lib/validation/auth";
import { validationError, type ActionResult } from "@/lib/validation/form-result";

/**
 * "Send me a test" on the admin system page. Sends straight away (not through
 * the queue), so the admin sees Termii's or Resend's own answer at once,
 * which is the quickest way to tell a missing key from an unapproved sender ID.
 */

const errorText = (err: unknown) => scrub(err instanceof Error ? err.message : String(err)).slice(0, 400);

export async function sendTestSmsAction(input: { phone: string }): Promise<ActionResult> {
  const parsed = phoneOnlySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { actor, run } = await adminContext("system_health.view");
    if (!(await rateLimit(`admin:test-sms:${actor.id}`, 5, 3600)).allowed) throw new AdminError("You've sent 5 test texts this hour. Try again later.");
    const to = parsed.data.phone;
    try {
      const { provider, id } = await sendTracked("sms", { to, body: "TownMart test message: texts from TownMart are working." }, smsProvider, env().SMS_PROVIDER);
      await run((_tx, audit) => audit("messages.test_sent", "user", actor.id, { channel: "sms", provider, ok: true }));
      return { ok: true, message: provider === "termii" ? `Termii accepted the text to ${maskPhone(to)} (message ${id}). It should arrive within a minute.` : `Sent to the ${provider === "outbox" ? "test inbox" : "server log"}, because real texts aren't switched on.` };
    } catch (err) {
      await run((_tx, audit) => audit("messages.test_sent", "user", actor.id, { channel: "sms", ok: false }));
      return { ok: false, error: `The text wasn't sent. ${errorText(err)}` };
    } finally {
      revalidatePath("/admin/system");
    }
  } catch (err) {
    return adminFailure(err, "test sms");
  }
}

export async function sendTestEmailAction(): Promise<ActionResult> {
  try {
    const { actor, run } = await adminContext("system_health.view");
    if (!(await rateLimit(`admin:test-email:${actor.id}`, 5, 3600)).allowed) throw new AdminError("You've sent 5 test emails this hour. Try again later.");
    const message = {
      to: actor.email,
      subject: "TownMart test email",
      text: "This is a test from the TownMart admin system page. Emails from TownMart are working.",
      html: "<p>This is a test from the TownMart admin system page. Emails from TownMart are working.</p>",
    };
    try {
      const { provider } = await sendTracked("email", message, emailProvider, env().EMAIL_PROVIDER);
      await run((_tx, audit) => audit("messages.test_sent", "user", actor.id, { channel: "email", provider, ok: true }));
      return { ok: true, message: provider === "outbox" ? "Sent to the test inbox, because real email isn't switched on." : `Sent to ${actor.email}. Check the inbox and the spam folder.` };
    } catch (err) {
      await run((_tx, audit) => audit("messages.test_sent", "user", actor.id, { channel: "email", ok: false }));
      return { ok: false, error: `The email wasn't sent. ${errorText(err)}` };
    } finally {
      revalidatePath("/admin/system");
    }
  } catch (err) {
    return adminFailure(err, "test email");
  }
}
