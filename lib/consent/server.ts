import { cookies } from "next/headers";
import { withRls } from "@/lib/db";
import { currentDocument } from "@/lib/legal/documents";
import { CONSENT_COOKIE, parseConsent, type Consent } from "./cookie";

export async function readConsent(): Promise<Consent | null> {
  return parseConsent((await cookies()).get(CONSENT_COOKIE)?.value);
}

/** The Cookie Policy version choices are recorded against. */
export async function cookiePolicyVersion(): Promise<string | null> {
  return (await withRls({ userId: null }, (tx) => currentDocument(tx, "cookies")))?.version ?? null;
}
