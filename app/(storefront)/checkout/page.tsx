import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutForm, type SavedAddress } from "@/components/checkout/checkout-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { findCartOwner } from "@/lib/cart";
import { computeCheckout } from "@/lib/checkout/compute";
import { toCheckoutView, withNearerOffers } from "@/lib/checkout/view";
import { nearerOffers } from "@/lib/catalogue/nearer";
import { loadDestination } from "@/lib/checkout/destination";
import { decrypt } from "@/lib/crypto";
import { withRls, withSystemContext } from "@/lib/db";
import { IN_SERVICE_AREA, serviceAreaOptions } from "@/lib/service-area-db";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const [owner, user] = await Promise.all([findCartOwner(), getCurrentUser()]);
  if (!owner.cartId) redirect("/cart");

  const [addresses, states] = await Promise.all([
    user
      ? withRls({ userId: user.id }, (tx) =>
          // Saved addresses outside the service area can't be delivered to, so they aren't offered.
          tx.address.findMany({ where: { userId: user.id, lga: IN_SERVICE_AREA }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }], include: { state: true, lga: true } }),
        )
      : Promise.resolve([]),
    withRls({ userId: null }, (tx) => serviceAreaOptions(tx)),
  ]);
  const saved: SavedAddress[] = addresses.map((a) => ({
    id: a.id,
    label: a.label,
    recipientName: a.recipientName,
    summary: `${decrypt(a.line1Encrypted)}, ${a.city}, ${a.lga.name}, ${a.state.name}`,
    stateId: a.stateId,
    lgaId: a.lgaId,
    pinned: a.latitude !== null,
  }));
  const first = saved[0];
  const { destination } = first && user ? await withRls({ userId: user.id }, (tx) => loadDestination(tx, { userId: user.id, addressId: first.id })) : { destination: null };
  const { c, offers } = await withSystemContext(async (tx) => {
    const c = await computeCheckout(tx, { cartId: owner.cartId, userId: owner.userId, address: destination });
    // Only from a real location: the town centre says nothing about which shop is nearer.
    const point = destination?.point && destination.point.source !== "area" ? destination.point : null;
    return { c, offers: await nearerOffers(tx, c.lines, point) };
  });
  if (c.lines.length === 0) redirect("/cart");

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">Checkout</h1>
      <CheckoutForm initialView={withNearerOffers(toCheckoutView(c), offers)} savedAddresses={saved} states={states} account={user ? { email: user.email, name: user.name } : null} />
    </main>
  );
}
