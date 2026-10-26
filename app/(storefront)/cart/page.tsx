import type { Metadata } from "next";
import { CartPage } from "@/components/cart/cart-page";
import { findCartOwner } from "@/lib/cart";
import { computeCheckout } from "@/lib/checkout/compute";
import { toCheckoutView } from "@/lib/checkout/view";
import { withSystemContext } from "@/lib/db";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function Cart() {
  const owner = await findCartOwner();
  // Prices, stock and promotions are re-checked every time the cart is opened.
  const c = await withSystemContext((tx) => computeCheckout(tx, { cartId: owner.cartId, userId: owner.userId, address: null }));
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">Your cart</h1>
      <CartPage view={toCheckoutView(c)} signedIn={owner.userId !== null} />
    </main>
  );
}
