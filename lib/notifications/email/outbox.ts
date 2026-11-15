import { addToOutbox } from "@/lib/notifications/outbox";
import type { EmailMessage, EmailProvider } from "./provider";

/** Test mode only (lib/env.ts refuses it elsewhere): keeps the email in the test inbox. */
export class OutboxEmailProvider implements EmailProvider {
  readonly name = "outbox";
  async send(message: EmailMessage) {
    return { id: await addToOutbox({ kind: "email", to: message.to, subject: message.subject, text: message.text }) };
  }
}
