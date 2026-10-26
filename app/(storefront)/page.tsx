import { BadgeCheck, ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";
import { SearchForm } from "@/components/layout/search-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { storefrontCategories } from "@/lib/navigation";

export default function HomePage() {
  return (
    <main id="main">
      <section className="bg-primary text-primary-foreground dark:bg-primary-soft dark:text-foreground">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-14 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-wider opacity-80">Shop local. Book local.</p>
          <h1 className="max-w-2xl text-4xl font-extrabold sm:text-5xl">Everything your town sells, in one place.</h1>
          <p className="max-w-xl text-lg opacity-90">
            Groceries, fashion, electronics and fresh farm produce, plus trusted plumbers, tailors and other artisans near
            you.
          </p>
          <SearchForm size="lg" className="max-w-2xl text-foreground" />
        </div>
      </section>

      <section aria-labelledby="categories" className="mx-auto max-w-7xl px-4 py-12">
        <h2 id="categories" className="mb-6 text-2xl font-bold">
          Shop by category
        </h2>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {storefrontCategories.map((c) => (
            <li key={c.slug}>
              <Link href={`/c/${c.slug}`} className="block focus-visible:outline-none">
                <Card className="flex h-full flex-col items-center gap-3 p-6 text-center transition-shadow hover:shadow-md">
                  <span className="text-4xl" aria-hidden>
                    {c.emoji}
                  </span>
                  <span className="font-semibold">{c.label}</span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Why TownMart" className="mx-auto max-w-7xl px-4 pb-4">
        <ul className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: BadgeCheck, title: "Verified sellers", body: "Every store is reviewed before it can sell." },
            { icon: ShieldCheck, title: "Protected payments", body: "Sellers are paid only after your order is delivered." },
            { icon: Truck, title: "Clear delivery fees", body: "See the full price, delivery included, before you pay." },
          ].map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <Card className="flex gap-4 p-6">
                <Icon className="size-6 shrink-0 text-primary" aria-hidden />
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground">{body}</p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12">
        <Card className="flex flex-col items-start gap-4 bg-accent-soft p-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold">Sell on TownMart</h2>
            <p className="text-muted-foreground">Open your store or list your services and reach customers in your area.</p>
          </div>
          <Button asChild variant="accent" size="lg">
            <Link href="/sell">Start selling</Link>
          </Button>
        </Card>
      </section>
    </main>
  );
}
