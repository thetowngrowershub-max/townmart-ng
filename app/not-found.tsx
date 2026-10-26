import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="font-heading text-6xl font-extrabold text-primary">404</p>
      <h1 className="text-2xl font-bold">We couldn&apos;t find that page</h1>
      <p className="text-muted-foreground">It may have moved, or the link may be wrong.</p>
      <Button asChild>
        <Link href="/">Back to TownMart</Link>
      </Button>
    </main>
  );
}
