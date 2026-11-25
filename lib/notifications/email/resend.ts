import { Resend } from "resend";
import type { EmailMessage, EmailProvider } from "./provider";

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  private readonly client: Resend;

  constructor(
    private readonly from: string,
    apiKey: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage) {
    const { data, error } = await this.client.emails.send({ from: this.from, ...message });
    if (error) throw new Error(`Resend error: ${error.name}: ${error.message}`);
    return { id: data?.id ?? null };
  }
}
