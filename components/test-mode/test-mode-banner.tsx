import Link from "next/link";

/** Shown on every page of a test-mode site (lib/platform.ts), so nobody mistakes it for the real shop. */
export function TestModeBanner() {
  // Read directly: the layout must render even while the settings are incomplete.
  const flutterwave = process.env.PAYMENT_PROVIDER === "flutterwave";
  const liveKey = flutterwave && process.env.FLUTTERWAVE_SECRET_KEY?.startsWith("FLWSECK-");
  return (
    <div role="note" aria-label="Test site" className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
      <strong className="font-semibold">Test site: no real money moves.</strong>{" "}
      {liveKey
        ? "Card payments are off. Payment testers are charged a small amount that is refunded automatically."
        : flutterwave
          ? "Pay with Flutterwave test cards only." : "Payments, bank checks, emails and SMS are pretend."}{" "}
      <Link href="/test-inbox" className="font-medium underline underline-offset-2">
        Test inbox
      </Link>
      {" · "}
      <Link href="/auth/demo" className="font-medium underline underline-offset-2">
        Demo accounts
      </Link>
    </div>
  );
}
