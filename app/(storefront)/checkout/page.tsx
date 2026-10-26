import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutForm, type SavedAddress } from "@/components/checkout/checkout-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { findCartOwner } from "@/lib/cart";
import { computeCheckout } from "@/lib/checkout/compute";
import { toCheckoutView } from "@/lib/checkout/view";
import { decrypt } from "@/lib/crypto";
import { withRls, withSystemContext } from "@/lib/db";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const [owner, user] = await Promise.all([findCartOwner(), getCurrentUser()]);
  if (!owner.cartId) redirect("/cart");

  const [addresses, states] = await Promise.all([
    user
      ? withRls({ userId: user.id }, (tx) =>
          tx.address.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }], include: { state: true, lga: true } }),
        )
      : Promise.resolve([]),
    withRls({ userId: null }, (tx) =>
      tx.state.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, lgas: { orderBy: { name: "asc" }, select: { id: true, name: true } } } }),
    ),
  ]);
  const saved: SavedAddress[] = addresses.map((a) => ({
    id: a.id,
    label: a.label,
    recipientName: a.recipientName,
    summary: `${decrypt(a.line1Encrypted)}, ${a.city}, ${a.lga.name}, ${a.state.name}`,
    stateId: a.stateId,
    lgaId: a.lgaId,
  }));
  const first = saved[0];
  const c = await withSystemContext((tx) =>
    computeCheckout(tx, { cartId: owner.cartId, userId: owner.userId, address: first ? { stateId: first.stateId, lgaId: first.lgaId } : null }),
  );
  if (c.lines.length === 0) redirect("/cart");

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">Checkout</h1>
      <CheckoutForm initialView={toCheckoutView(c)} savedAddresses={saved} states={states} account={user ? { email: user.email, name: user.name } : null} />
    </main>
  );
}
