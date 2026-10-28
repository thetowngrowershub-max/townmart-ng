/**
 * Prohibited-items screening. Admins keep a keyword list (setting
 * `moderation.prohibited_keywords`); a listing whose title, description,
 * brand or tags contain one is flagged for review. It stays live until a
 * moderator decides: keywords catch "fake" in "fake tan" too.
 */

export const KEYWORDS_SETTING = "moderation.prohibited_keywords";

export const DEFAULT_KEYWORDS = [
  "firearm",
  "pistol",
  "ammunition",
  "explosive",
  "cannabis",
  "marijuana",
  "tramadol",
  "codeine",
  "counterfeit",
  "replica",
  "ivory",
  "pangolin",
  "mercury cream",
  "human remains",
];

/** Normalises an admin's list: one entry per line or comma, lower case, de-duplicated. */
export function parseKeywords(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/[\n,]/)) {
    const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (k.length >= 3 && k.length <= 60) out.add(k);
  }
  return [...out].sort();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripHtml = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");

/** The keywords that appear as whole words (or phrases) in the listing's text. */
export function matchKeywords(listing: { title: string; descriptionHtml?: string | null; brand?: string | null; tags?: readonly string[] }, keywords: readonly string[]): string[] {
  const text = [listing.title, stripHtml(listing.descriptionHtml ?? ""), listing.brand ?? "", ...(listing.tags ?? [])].join(" \n ").toLowerCase();
  return keywords.filter((k) => new RegExp(`(^|[^a-z0-9])${escape(k).replace(/ /g, "\\s+")}s?($|[^a-z0-9])`, "i").test(text));
}
