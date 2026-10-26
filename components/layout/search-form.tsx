import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchForm({ className, size = "default" }: { className?: string; size?: "default" | "lg" }) {
  return (
    <form action="/search" role="search" className={cn("relative w-full", className)}>
      <label htmlFor={`q-${size}`} className="sr-only">
        Search TownMart
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id={`q-${size}`}
        name="q"
        type="search"
        placeholder="Search products, services and stores"
        className={cn(
          "w-full rounded-xl border border-input bg-card pl-9 pr-3 placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring",
          size === "lg" ? "h-14 text-base shadow-soft" : "h-11 text-sm",
        )}
      />
    </form>
  );
}
