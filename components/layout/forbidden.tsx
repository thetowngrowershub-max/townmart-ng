import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Forbidden({ message, cta }: { message: string; cta?: { href: string; label: string } }) {
  return (
    <main id="main" className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <ShieldAlert className="size-10 text-warning" aria-hidden />
      <h1 className="text-2xl font-bold">You don&apos;t have access to this page</h1>
      <p className="text-muted-foreground">{message}</p>
      <div className="flex gap-2">
        <Button asChild variant="outline">
          <Link href="/">Go home</Link>
        </Button>
        {cta && (
          <Button asChild>
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        )}
      </div>
    </main>
  );
}
