/**
 * Money is always integer kobo (BigInt). 100 kobo = ₦1.
 * Never use floating point for amounts.
 */

/** Formats kobo as `₦12,500.00`. */
export function formatNaira(kobo: bigint): string {
  const negative = kobo < 0n;
  const abs = negative ? -kobo : kobo;
  const naira = abs / 100n;
  const rest = abs % 100n;
  // Group digits on the string so amounts beyond Number's safe range stay exact.
  const grouped = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}₦${grouped}.${rest.toString().padStart(2, "0")}`;
}

/**
 * Parses a naira string typed by a user ("12,500", "12500.5", "₦1,000.00") into kobo.
 * Throws on anything that isn't a non-negative amount with at most 2 decimals.
 */
export function parseNairaToKobo(input: string): bigint {
  const cleaned = input.replace(/[₦,\s]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new Error(`Invalid naira amount: "${input}"`);
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  return whole * 100n + fraction;
}
