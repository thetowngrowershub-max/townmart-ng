import nodemailer from "nodemailer";
import type { EmailMessage, EmailProvider } from "./provider";

/** SMTP provider. Used with Mailpit in development (http://localhost:8025). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transport;

  constructor(
    private readonly from: string,
    host: string,
    port: number,
  ) {
    this.transport = nodemailer.createTransport({ host, port, secure: port === 465 });
  }

  async send(message: EmailMessage) {
    const info = await this.transport.sendMail({ from: this.from, ...message });
    return { id: info.messageId ?? null };
  }
}
