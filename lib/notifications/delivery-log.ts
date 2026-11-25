import { maskEmail, maskPhone } from "@/lib/phone";
import { redis } from "@/lib/redis";
import { scrub } from "@/lib/test-mode/page-errors";

/**
 * A short record of recent text-message and email sends, so the admin system
 * page and a test site's /api/health can say whether Termii and Resend work
 * without server logs. Keeps the last few failures and the time of the last
 * success. Never stores a message body (it can hold a one-time code), and
 * masks the recipient.
 */

export type Channel = "sms" | "email";
export type SendFailure = { at: string; provider: string; to: string; error: string };
export type ChannelLog = { lastSentAt: string | null; lastProvider: string | null; failures: SendFailure[] };

const KEEP = 10;
const TTL = 14 * 86_400;
const failKey = (c: Channel) => `message-failures:${c}`;
const okKey = (c: Channel) => `message-last-ok:${c}`;

export function maskRecipient(channel: Channel, to: string): string {
  if (channel === "email") return maskEmail(to.replace(/^.*<([^>]+)>.*$/, "$1"));
  return to.startsWith("+234") ? maskPhone(to) : `${to.slice(0, 4)}…`;
}

export async function recordSent(channel: Channel, provider: string): Promise<void> {
  await redis.set(okKey(channel), JSON.stringify({ at: new Date().toISOString(), provider }), "EX", TTL);
}

export async function recordFailed(channel: Channel, provider: string, to: string, err: unknown): Promise<void> {
  const entry: SendFailure = {
    at: new Date().toISOString(),
    provider,
    to: maskRecipient(channel, to),
    error: scrub(err instanceof Error ? err.message : String(err)).slice(0, 300),
  };
  await redis.multi().lpush(failKey(channel), JSON.stringify(entry)).ltrim(failKey(channel), 0, KEEP - 1).expire(failKey(channel), TTL).exec();
}

type Sender<M> = { readonly name: string; send(message: M): Promise<{ id: string | null }> };

/**
 * Sends through the provider and records the outcome, including a provider
 * that can't start (a missing key). The record never hides the real error.
 */
export async function sendTracked<M extends { to: string }>(channel: Channel, message: M, provider: () => Sender<M>, fallbackName: string): Promise<{ id: string | null; provider: string }> {
  let name = fallbackName;
  try {
    const p = provider();
    name = p.name;
    const { id } = await p.send(message);
    await recordSent(channel, name).catch(() => undefined);
    return { id, provider: name };
  } catch (err) {
    await recordFailed(channel, name, message.to, err).catch(() => undefined);
    throw err;
  }
}

export async function channelLog(channel: Channel, limit = 5): Promise<ChannelLog> {
  const [ok, failures] = await Promise.all([redis.get(okKey(channel)), redis.lrange(failKey(channel), 0, limit - 1)]);
  const last = ok ? (JSON.parse(ok) as { at: string; provider: string }) : null;
  return { lastSentAt: last?.at ?? null, lastProvider: last?.provider ?? null, failures: failures.map((s) => JSON.parse(s) as SendFailure) };
}
