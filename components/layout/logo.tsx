import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The TownMart wordmark: orange "town mart" with the cart between the words.
 * One SVG (public/brand/townmart-logo.svg) that lightens the cart's teal
 * handle in dark mode by itself, so it stays visible on dark backgrounds.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    // An SVG needs no optimising, and next/image would drop its dark-mode style.
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/townmart-logo.svg" alt="TownMart" width={513} height={135} className={cn("h-8 w-auto sm:h-9", className)} />
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center rounded-lg">
      <LogoMark className={className} />
    </Link>
  );
}
