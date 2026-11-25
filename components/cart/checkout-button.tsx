"use client";

import Link from "next/link";
import { useOnline } from "@/components/pwa/use-online";
import { Button } from "@/components/ui/button";

/** Checkout needs a live connection: prices, stock and payment are only ever settled by TownMart. */
export function CheckoutButton() {
  const online = useOnline();
  if (!online) {
    return (
      <div className="flex flex-col gap-2">
        <Button size="lg" className="w-full" disabled>
          Check out
        </Button>
        <p className="text-center text-sm text-muted-foreground">You&apos;re offline. You can check out when you&apos;re back online.</p>
      </div>
    );
  }
  return (
    <Button asChild size="lg" className="w-full">
      <Link href="/checkout">Check out</Link>
    </Button>
  );
}
