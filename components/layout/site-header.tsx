import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cartCount } from "@/lib/cart";
import { Logo } from "./logo";
import { SearchForm } from "./search-form";
import { UserMenu } from "./user-menu";

/**
 * Shared by the storefront, the account area and the seller dashboard.
 * Phones get one row of logo + icons and the search box on its own row;
 * from md the search sits between them and shrinks before anything else.
 */
export async function SiteHeader() {
  const count = await cartCount().catch(() => 0);
  const cart = (
    <Button asChild variant="ghost" size="icon" aria-label={count ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart"} className="relative">
      <Link href="/cart">
        <ShoppingCart aria-hidden />
        {count > 0 && (
          <span aria-hidden className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </Button>
  );
  return (
    <header className="sticky top-0 z-40 border-t-[3px] border-t-accent border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-4">
        <Logo className="h-7 sm:h-9" />
        <SearchForm id="q-header" className="hidden min-w-0 max-w-xl flex-1 md:block" />
        <div className="ml-auto flex shrink-0 items-center">
          <UserMenu cart={cart} />
        </div>
      </div>
      <div className="px-4 pb-3 md:hidden">
        <SearchForm id="q-header-mobile" />
      </div>
    </header>
  );
}
