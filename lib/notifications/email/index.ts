import { env } from "@/lib/env";
import type { EmailProvider } from "./provider";
import { OutboxEmailProvider } from "./outbox";
import { ResendEmailProvider } from "./resend";
import { SmtpEmailProvider } from "./smtp";

export type { EmailMessage, EmailProvider } from "./provider";

let provider: EmailProvider | undefined;

export function emailProvider(): EmailProvider {
  if (!provider) {
    const e = env();
    if (e.EMAIL_PROVIDER === "resend") {
      if (!e.RESEND_API_KEY) throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
      provider = new ResendEmailProvider(e.EMAIL_FROM, e.RESEND_API_KEY);
    } else if (e.EMAIL_PROVIDER === "outbox") {
      provider = new OutboxEmailProvider();
    } else {
      provider = new SmtpEmailProvider(e.EMAIL_FROM, e.SMTP_HOST, e.SMTP_PORT);
    }
  }
  return provider;
}
