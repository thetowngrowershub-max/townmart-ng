import { headers } from "next/headers";
import { ipHash } from "@/lib/crypto";

/**
 * Client IP and user agent for rate limiting and audit. Only the first
 * X-Forwarded-For hop is used; Caddy/Nginx in front of the app must overwrite
 * (not append to) that header from untrusted clients.
 */
export async function requestMeta(): Promise<{ ip: string; ipHash: string; userAgent: string | null }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return { ip, ipHash: ipHash(ip), userAgent: h.get("user-agent")?.slice(0, 255) ?? null };
}
