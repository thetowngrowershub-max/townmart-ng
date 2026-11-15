import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";

/**
 * The test inbox (/test-inbox): on a test-mode site, emails and SMS are kept
 * here instead of being sent, so testers can open sign-up links and read
 * one-time codes. Only the newest 200 are kept, for a week.
 */
export type OutboxMessage =
  | { id: string; kind: "email"; to: string; subject: string; text: string; at: string }
  | { id: string; kind: "sms"; to: string; text: string; at: string };

const KEY = "test-outbox";
const KEEP = 200;

type NewMessage = { kind: "email"; to: string; subject: string; text: string } | { kind: "sms"; to: string; text: string };

export async function addToOutbox(message: NewMessage): Promise<string> {
  const id = randomUUID();
  const entry = { ...message, id, at: new Date().toISOString() } as OutboxMessage;
  await redis.multi().lpush(KEY, JSON.stringify(entry)).ltrim(KEY, 0, KEEP - 1).expire(KEY, 7 * 86_400).exec();
  return id;
}

export async function readOutbox(filter?: string): Promise<OutboxMessage[]> {
  const all = (await redis.lrange(KEY, 0, KEEP - 1)).map((raw) => JSON.parse(raw) as OutboxMessage);
  const q = filter?.trim().toLowerCase();
  return q ? all.filter((m) => m.to.toLowerCase().includes(q)) : all;
}
