"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleWishlistAction } from "@/lib/wishlist/actions";

export function RemoveSaved({ target, title }: { target: { productId: string } | { serviceId: string }; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Remove ${title} from your wishlist`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await toggleWishlistAction(target);
          router.refresh();
        })
      }
    >
      <X aria-hidden />
    </Button>
  );
}
