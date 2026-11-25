/**
 * The Content-Security-Policy sent with every page. Scripts run only with the
 * per-request nonce ('strict-dynamic' lets those scripts load what they need,
 * such as Turnstile and the consent-gated analytics). Styles allow inline
 * because React and Next.js set style attributes. Pure, so it is unit-tested.
 */

export type CspOptions = {
  nonce: string;
  dev: boolean;
  /** The site is served over HTTPS (APP_URL); asks browsers to upgrade stray http:// links. */
  https: boolean;
  /** Where browsers send presigned uploads (S3_ENDPOINT) and fetch public images (S3_PUBLIC_BASE_URL). */
  storageUrls: (string | undefined)[];
  /** Consent-gated analytics and marketing script URLs. */
  scriptUrls: (string | undefined)[];
  /** Extra sources an admin needs, e.g. an analytics tool's beacon host (CSP_EXTRA_SOURCES). */
  extra?: string;
};

/** Hosted payment pages a checkout form may be redirected to. */
export const PAYMENT_ORIGINS = ["https://checkout.paystack.com", "https://checkout.flutterwave.com"];
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Only plain host sources may come from configuration; anything with quotes or separators is dropped. */
export function cleanSources(list: string | undefined): string[] {
  return (list ?? "")
    .split(/\s+/)
    .filter((s) => /^(https:\/\/)?(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(s));
}

const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];

export function buildCsp(o: CspOptions): string {
  const storage = uniq(o.storageUrls.map(originOf));
  const scripts = uniq(o.scriptUrls.map(originOf));
  const extra = cleanSources(o.extra);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Host sources are a fallback for browsers without 'strict-dynamic'.
    "script-src": ["'self'", `'nonce-${o.nonce}'`, "'strict-dynamic'", TURNSTILE_ORIGIN, ...scripts, ...extra, ...(o.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...storage, ...scripts, ...extra],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...storage, ...scripts, ...extra, ...(o.dev ? ["ws:"] : [])],
    "frame-src": [TURNSTILE_ORIGIN, ...extra],
    "form-action": ["'self'", ...PAYMENT_ORIGINS],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${uniq(v).join(" ")}`);
  if (o.https) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
