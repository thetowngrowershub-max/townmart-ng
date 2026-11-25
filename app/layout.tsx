import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { ConsentManager } from "@/components/consent/consent-manager";
import { TestModeBanner } from "@/components/test-mode/test-mode-banner";
import { MaintenanceTick } from "@/components/test-mode/maintenance-tick";
import { isTestMode, jobsInline, platformAppUrl } from "@/lib/platform";
import "./globals.css";
import { Connectivity } from "@/components/pwa/connectivity";

/**
 * Headings only, basic Latin only (27 KB). The Google version also declared
 * the Latin Extended file, which phones downloaded just for the naira sign
 * (another 106 KB with Inter). The naira sign now comes from the phone's font.
 * Plus Jakarta Sans is under the SIL Open Font License (app/fonts/OFL.txt).
 */
const jakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin.woff2",
  weight: "200 800",
  variable: "--font-jakarta",
  display: "swap",
  fallback: ["system-ui", "Arial"],
});

export const metadata: Metadata = {
  metadataBase: new URL(platformAppUrl() ?? "http://localhost:3000"),
  applicationName: "TownMart",
  title: { default: "TownMart — Everything your town sells, in one place", template: "%s · TownMart" },
  description:
    "Shop groceries, fashion, electronics and farm produce, and book trusted service providers and artisans near you across Nigeria.",
  openGraph: { siteName: "TownMart", locale: "en_NG", type: "website" },
  ...(isTestMode() ? { robots: { index: false, follow: false } } : {}),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0F6B3E" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1210" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG" className={jakarta.variable}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-card focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        {isTestMode() ? <TestModeBanner /> : null}
        <Connectivity />
        {children}
        {jobsInline() ? <MaintenanceTick /> : null}
        <ConsentManager />
      </body>
    </html>
  );
}
