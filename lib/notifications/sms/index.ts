import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export type SmsMessage = { to: string; body: string };

/** Every SMS goes through this interface so the gateway can be swapped by env var. */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<{ id: string | null }>;
}

/** Termii (Nigerian SMS gateway). https://developers.termii.com/messaging-api */
class TermiiSmsProvider implements SmsProvider {
  readonly name = "termii";
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string,
    private readonly baseUrl: string,
  ) {}

  async send({ to, body }: SmsMessage) {
    const res = await fetch(`${this.baseUrl}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        to: to.replace(/^\+/, ""),
        from: this.senderId,
        sms: body,
        type: "plain",
        channel: "dnd", // delivers to DND numbers, required for OTPs in Nigeria
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string };
    if (!res.ok) throw new Error(`Termii error ${res.status}: ${data.message ?? "unknown"}`);
    return { id: data.message_id ?? null };
  }
}

/** Development only (refused in production): prints the message to the worker log. */
class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  async send({ to, body }: SmsMessage) {
    logger.info({ smsTo: `${to.slice(0, 7)}…${to.slice(-2)}`, smsBody: body }, "SMS (console provider)");
    return { id: null };
  }
}

let provider: SmsProvider | undefined;

export function smsProvider(): SmsProvider {
  if (!provider) {
    const e = env();
    if (e.SMS_PROVIDER === "termii") {
      if (!e.TERMII_API_KEY) throw new Error("TERMII_API_KEY is required when SMS_PROVIDER=termii");
      provider = new TermiiSmsProvider(e.TERMII_API_KEY, e.TERMII_SENDER_ID, e.TERMII_BASE_URL);
    } else {
      provider = new ConsoleSmsProvider();
    }
  }
  return provider;
}
