import { headers } from "next/headers";
import Script from "next/script";
import { allowedScripts, NO_CONSENT, needsConsent } from "@/lib/consent/cookie";
import { cookiePolicyVersion, readConsent } from "@/lib/consent/server";
import { env } from "@/lib/env";
import { ConsentBanner } from "./consent-banner";

/**
 * Shows the cookie banner when a choice is needed, and adds analytics or
 * marketing scripts only for visitors who allowed them. Nothing optional is
 * rendered before consent.
 */
export async function ConsentManager() {
  const [consent, version, h] = await Promise.all([readConsent(), cookiePolicyVersion(), headers()]);
  const nonce = h.get("x-nonce") ?? undefined;
  const e = env();
  const scripts = allowedScripts(consent, version, { analytics: e.ANALYTICS_SCRIPT_URL, marketing: e.MARKETING_SCRIPT_URL });
  const current = consent ? { functional: consent.functional, analytics: consent.analytics, marketing: consent.marketing } : NO_CONSENT;
  return (
    <>
      <ConsentBanner initialOpen={needsConsent(consent, version)} current={current} />
      {scripts.map((src) => (
        <Script key={src} src={src} strategy="afterInteractive" nonce={nonce} />
      ))}
    </>
  );
}
