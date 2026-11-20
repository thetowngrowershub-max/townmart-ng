import type { Metadata } from "next";
import { CartPage } from "@/components/cart/cart-page";
import { findCartOwner } from "@/lib/cart";
import { computeCheckout } from "@/lib/checkout/compute";
import { toCheckoutView, withNearerOffers } from "@/lib/checkout/view";
import { nearerOffers } from "@/lib/catalogue/nearer";
import { nearMe } from "@/lib/geo/near-me";
import { withSystemContext } from "@/lib/db";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function Cart() {
  const owner = await findCartOwner();
  // Prices, stock and promotions are re-checked every time the cart is opened.
  const near = await nearMe();
  const { c, offers } = await withSystemContext(async (tx) => {
    const c = await computeCheckout(tx, { cartId: owner.cartId, userId: owner.userId, address: null });
    return { c, offers: await nearerOffers(tx, c.lines, near) };
  });
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">Your cart</h1>
      <CartPage view={withNearerOffers(toCheckoutView(c), offers)} signedIn={owner.userId !== null} />
    </main>
  );
}
