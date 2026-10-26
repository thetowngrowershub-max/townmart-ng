import { Star } from "lucide-react";

export function Rating({ avg, count, className }: { avg: number; count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${className ?? ""}`}>
      <Star className="size-3.5 fill-accent text-accent" aria-hidden />
      <span className="font-semibold">{avg.toFixed(1)}</span>
      <span className="text-muted-foreground">({count})</span>
      <span className="sr-only">
        Rated {avg.toFixed(1)} out of 5 from {count} review{count === 1 ? "" : "s"}
      </span>
    </span>
  );
}
