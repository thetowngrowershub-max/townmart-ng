import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { addToOutbox } from "@/lib/notifications/outbox";

export type SmsMessage = { to: string; body: string };

/** Every SMS goes through this interface so the gateway can be swapped by env var. */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<{ id: string | null }>;
}

/** Termii (Nigerian SMS gateway). https://developers.termii.com/messaging-api */
export class TermiiSmsProvider implements SmsProvider {
  readonly name = "termii";
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string,
    private readonly baseUrl: string,
    private readonly channel: "dnd" | "generic",
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
        // "dnd" delivers to numbers on Do-Not-Disturb, which most OTPs in Nigeria need.
        channel: this.channel,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { message_id?: string | number; message?: string; code?: string };
    if (!res.ok) throw new Error(`Termii error ${res.status}: ${termiiHint(data.message)}`);
    // Termii can answer 200 without sending (for example an empty wallet); only a message id means it went.
    if (!data.message_id) throw new Error(`Termii didn't send the text: ${termiiHint(data.message)}`);
    return { id: String(data.message_id) };
  }
}

/** Termii's error, with what to do about the common setup ones. */
export function termiiHint(message: string | undefined): string {
  const m = message ?? "no reason given";
  if (/sender\s*id/i.test(m)) return `${m} (the sender ID isn't approved yet, or TERMII_SENDER_ID doesn't match it exactly)`;
  if (/dnd/i.test(m)) return `${m} (ask Termii support to enable the DND route, or set TERMII_CHANNEL=generic for now)`;
  if (/balance|insufficient|fund/i.test(m)) return `${m} (top up the Termii wallet)`;
  if (/api.?key|unauthori[sz]ed|invalid key/i.test(m)) return `${m} (check TERMII_API_KEY and TERMII_BASE_URL)`;
  return m;
}

/** Development only (refused in production): prints the message to the worker log. */
class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  async send({ to, body }: SmsMessage) {
    logger.info({ smsTo: `${to.slice(0, 7)}…${to.slice(-2)}`, smsBody: body }, "SMS (console provider)");
    return { id: null };
  }
}

/** Test mode only (lib/env.ts refuses it elsewhere): keeps the SMS in the test inbox. */
class OutboxSmsProvider implements SmsProvider {
  readonly name = "outbox";
  async send({ to, body }: SmsMessage) {
    return { id: await addToOutbox({ kind: "sms", to, text: body }) };
  }
}

let provider: SmsProvider | undefined;

export function smsProvider(): SmsProvider {
  if (!provider) {
    const e = env();
    if (e.SMS_PROVIDER === "termii") {
      if (!e.TERMII_API_KEY) throw new Error("TERMII_API_KEY is required when SMS_PROVIDER=termii");
      provider = new TermiiSmsProvider(e.TERMII_API_KEY, e.TERMII_SENDER_ID, e.TERMII_BASE_URL, e.TERMII_CHANNEL);
    } else if (e.SMS_PROVIDER === "outbox") {
      provider = new OutboxSmsProvider();
    } else {
      provider = new ConsoleSmsProvider();
    }
  }
  return provider;
}
