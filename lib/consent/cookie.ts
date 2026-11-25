/**
 * The cookie-consent cookie. Necessary cookies need no consent; the other
 * three categories are off until the visitor turns them on. The value holds a
 * random subject id (to find the visitor's consent records), the choices, the
 * Cookie Policy version they were made under, and when.
 */
export const CONSENT_COOKIE = "tm_consent";
/** A choice is asked for again after 12 months, or when the Cookie Policy changes. */
export const CONSENT_MAX_AGE_DAYS = 365;

export const CONSENT_CATEGORIES = ["functional", "analytics", "marketing"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
export type ConsentChoices = Record<ConsentCategory, boolean>;
export type Consent = ConsentChoices & { subjectId: string; version: string; at: Date };

export const NO_CONSENT: ConsentChoices = { functional: false, analytics: false, marketing: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function serialiseConsent(c: Consent): string {
  const bits = CONSENT_CATEGORIES.map((k) => (c[k] ? "1" : "0")).join("");
  return [c.subjectId, bits, encodeURIComponent(c.version), Math.floor(c.at.getTime() / 1000)].join(".");
}

export function parseConsent(value: string | undefined | null): Consent | null {
  if (!value) return null;
  const [subjectId, bits, version, at] = value.split(".");
  if (!subjectId || !UUID.test(subjectId) || !bits || !/^[01]{3}$/.test(bits) || !version || !at || !/^\d+$/.test(at)) return null;
  const choices = Object.fromEntries(CONSENT_CATEGORIES.map((k, i) => [k, bits[i] === "1"])) as ConsentChoices;
  return { ...choices, subjectId, version: decodeURIComponent(version), at: new Date(Number(at) * 1000) };
}

/** Whether to show the banner: no valid choice yet, it has expired, or the policy changed since. */
export function needsConsent(c: Consent | null, policyVersion: string | null, now = new Date()): boolean {
  if (!c) return true;
  if (now.getTime() - c.at.getTime() > CONSENT_MAX_AGE_DAYS * 86_400_000) return true;
  return policyVersion !== null && c.version !== policyVersion;
}

/**
 * The optional scripts a page may load: only those whose category the visitor
 * allowed, and only while their choice is current.
 */
export function allowedScripts(c: Consent | null, policyVersion: string | null, scripts: { analytics?: string; marketing?: string }, now = new Date()): string[] {
  if (!c || needsConsent(c, policyVersion, now)) return [];
  return (["analytics", "marketing"] as const).flatMap((k) => (c[k] && scripts[k] ? [scripts[k]!] : []));
}
