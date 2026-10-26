import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "./logo";
import { SearchForm } from "./search-form";
import { UserMenu } from "./user-menu";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <Logo />
        <SearchForm id="q-header" className="hidden max-w-xl flex-1 md:block" />
        <div className="ml-auto flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" aria-label="Cart">
            <Link href="/cart">
              <ShoppingCart aria-hidden />
            </Link>
          </Button>
          <UserMenu />
        </div>
      </div>
      <div className="px-4 pb-3 md:hidden">
        <SearchForm id="q-header-mobile" />
      </div>
    </header>
  );
}
