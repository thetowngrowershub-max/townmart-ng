import { randomBytes } from "node:crypto";
import { slugify } from "@/lib/slug";

/** URL slug for a listing: readable prefix plus a short random suffix so titles can repeat. */
export function listingSlug(title: string): string {
  const base = slugify(title).slice(0, 60).replace(/-+$/, "") || "item";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

export const STORE_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const RESERVED_STORE_SLUGS = new Set(["admin", "api", "townmart", "support", "help", "sell", "store", "account", "dashboard"]);
