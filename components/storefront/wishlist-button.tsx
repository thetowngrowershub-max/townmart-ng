"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleWishlistAction } from "@/lib/wishlist/actions";
import { cn } from "@/lib/utils";

/** Heart button on a listing. Signed-out shoppers are sent to sign in and brought back. */
export function WishlistButton({ target, saved: initial, signedIn, returnTo }: { target: { productId: string } | { serviceId: string }; saved: boolean; signedIn: boolean; returnTo: string }) {
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!signedIn)
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/auth/sign-in?next=${encodeURIComponent(returnTo)}`}>
          <Heart aria-hidden /> Save
        </Link>
      </Button>
    );
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        aria-pressed={saved}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setSaved((s) => !s);
            const res = await toggleWishlistAction(target);
            if (res.ok) {
              setSaved(res.data!.saved);
              setError(null);
            } else {
              setSaved((s) => !s);
              setError(res.error);
            }
          })
        }
      >
        <Heart aria-hidden className={cn(saved && "fill-danger text-danger")} /> {saved ? "Saved" : "Save"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
