import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchForm({
  id,
  className,
  size = "default",
  defaultValue,
}: {
  /** Unique per page: the header renders two of these (desktop and mobile). */
  id: string;
  className?: string;
  size?: "default" | "lg";
  defaultValue?: string;
}) {
  return (
    <form action="/search" role="search" className={cn("relative w-full", className)}>
      <label htmlFor={id} className="sr-only">
        Search TownMart
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id={id}
        name="q"
        type="search"
        defaultValue={defaultValue}
        maxLength={100}
        placeholder="Search products, services and stores"
        className={cn(
          "w-full rounded-xl border border-input bg-card pl-9 pr-3 placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring",
          size === "lg" ? "h-14 text-base shadow-soft" : "h-11 text-sm",
        )}
      />
    </form>
  );
}
