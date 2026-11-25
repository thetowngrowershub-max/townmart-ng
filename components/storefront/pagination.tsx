import Link from "next/link";

export function Pagination({ page, total, pageSize, href }: { page: number; total: number; pageSize: number; href: (page: number) => string }) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  return (
    <nav aria-label="Pages" className="mt-8 flex flex-wrap items-center justify-center gap-1 text-sm">
      {page > 1 && (
        <Link href={href(page - 1)} className="rounded-lg px-3 py-2 hover:bg-muted" rel="prev">
          Previous
        </Link>
      )}
      {nums.map((n, i) => (
        <span key={n} className="flex items-center">
          {i > 0 && n - nums[i - 1]! > 1 && <span className="px-1 text-muted-foreground">…</span>}
          <Link
            href={href(n)}
            aria-current={n === page ? "page" : undefined}
            className={`rounded-lg px-3 py-2 ${n === page ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted"}`}
          >
            {n}
          </Link>
        </span>
      ))}
      {page < pages && (
        <Link href={href(page + 1)} className="rounded-lg px-3 py-2 hover:bg-muted" rel="next">
          Next
        </Link>
      )}
    </nav>
  );
}
