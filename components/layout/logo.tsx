import { Store } from "lucide-react";
import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-heading text-lg font-bold text-primary">
      <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Store className="size-5" aria-hidden />
      </span>
      TownMart
    </Link>
  );
}
