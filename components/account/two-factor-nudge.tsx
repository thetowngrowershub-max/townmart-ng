import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { prisma } from "@/lib/db";

/**
 * A reminder on the seller and admin overviews while two-step sign-in is off.
 * These accounts hold money and customer data, so they matter most.
 */
export async function TwoFactorNudge({ userId, who }: { userId: string; who: "seller" | "admin" }) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabledAt: true } });
  if (!u || u.twoFactorEnabledAt) return null;
  return (
    <Alert variant="warning" className="mb-6">
      <strong>Protect your {who === "seller" ? "store and payouts" : "admin account"}.</strong> Turn on two-step sign-in so a stolen password alone can&apos;t get in.{" "}
      <Link href="/account/security" className="font-semibold underline">
        Turn it on
      </Link>
    </Alert>
  );
}
