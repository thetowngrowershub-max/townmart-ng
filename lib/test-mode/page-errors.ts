import { redis } from "@/lib/redis";

const KEY = "test-page-errors";

/** Hides anything that looks like a connection string's password or a long token. */
export function scrub(message: string): string {
  return message
    .replace(/(\w+:\/\/[^:\s/]+:)[^@\s]+@/g, "$1***@")
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, "***")
    .slice(0, 1_500);
}

export async function recordPageError(
  error: unknown,
  path: string,
): Promise<void> {
  const e = error instanceof Error ? error : new Error(String(error));
  const entry = {
    at: new Date().toISOString(),
    path,
    digest: (e as Error & { digest?: string }).digest,
    message: scrub(`${e.name}: ${e.message}`),
    where: scrub((e.stack ?? "").split("\n").slice(1, 6).join("\n")),
  };
  await redis
    .multi()
    .lpush(KEY, JSON.stringify(entry))
    .ltrim(KEY, 0, 9)
    .expire(KEY, 3 * 86_400)
    .exec();
}

export async function recentPageErrors(): Promise<unknown[]> {
  return (await redis.lrange(KEY, 0, 4)).map((s) => JSON.parse(s) as unknown);
}
