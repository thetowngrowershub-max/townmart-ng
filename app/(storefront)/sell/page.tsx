import { BadgeCheck, CalendarCheck, Package, ShieldCheck, Smartphone, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSellerContext } from "@/lib/seller/context";

export const metadata: Metadata = {
  title: "Sell on TownMart",
  description: "Sell products or offer services to shoppers across Nigeria. Free to join; you only pay commission when you make a sale.",
};

const BENEFITS = [
  { icon: Package, title: "Products and services", body: "List groceries, fashion, electronics or farm produce, or take bookings for your trade." },
  { icon: Wallet, title: "Paid to your bank", body: "Customers pay online through Paystack. Payouts go to your verified Nigerian bank account." },
  { icon: Smartphone, title: "Built for your phone", body: "Add listings, update stock and answer customers from any phone, even on slow data." },
  { icon: ShieldCheck, title: "Protected payments", body: "We hold payment until delivery, so customers buy with confidence and you get fewer disputes." },
  { icon: CalendarCheck, title: "Bookings without clashes", body: "Set your weekly hours and slot length; TownMart never double-books you." },
  { icon: BadgeCheck, title: "Verified sellers only", body: "Every seller is checked before going live, which keeps shoppers coming back." },
];

const STEPS = ["Tell us about your business", "Verify your phone and ID", "Add your bank account", "Accept the seller agreement", "We review, usually within 2 working days"];

export default async function SellPage() {
  const [user, seller] = await Promise.all([getCurrentUser(), getSellerContext()]);
  const cta = seller
    ? seller.business.status === "approved"
      ? { href: "/dashboard", label: "Go to your dashboard" }
      : { href: "/sell/onboarding", label: "Continue your application" }
    : user
      ? { href: "/sell/onboarding", label: "Start selling" }
      : { href: "/auth/sign-up?next=/sell/onboarding", label: "Create an account to start" };

  return (
    <main id="main">
      <section className="bg-primary-soft">
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-5 px-4 py-14 sm:py-20">
          <h1 className="max-w-2xl text-3xl font-bold sm:text-5xl">Sell to your town, and the rest of Nigeria</h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Open a TownMart store for free. List products or services, get paid online, and grow with customers near you.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href={cta.href}>{cta.label}</Link>
            </Button>
            {!user && (
              <Button asChild size="lg" variant="outline">
                <Link href="/auth/sign-in?next=/sell/onboarding">I already have an account</Link>
              </Button>
            )}
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-12 sm:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="size-6 text-primary" aria-hidden />
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription>{body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <Card>
          <CardHeader>
            <CardTitle>How it works</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-3 sm:grid-cols-5">
              {STEPS.map((s, i) => (
                <li key={s} className="flex gap-3 sm:flex-col">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">{i + 1}</span>
                  <span className="text-sm">{s}</span>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-sm text-muted-foreground">
              You&apos;ll need: a phone number, a government ID (or your CAC certificate) and a Nigerian bank account.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
