"use client";

import { sendSignInCodeAction, verifySignInCodeAction } from "@/lib/auth/phone-actions";
import { PhoneCodeFlow } from "./phone-code-flow";

export function PhoneSignIn({ next }: { next?: string }) {
  return <PhoneCodeFlow send={sendSignInCodeAction} verify={({ phone, code }) => verifySignInCodeAction({ phone, code, next })} submitLabel="Sign in" />;
}
