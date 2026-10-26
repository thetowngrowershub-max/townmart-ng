import { Info } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePermission } from "@/lib/auth/current-user";
import { formatNaira } from "@/lib/money";

export const metadata: Metadata = { title: "Design system" };

const COLOR_TOKENS = [
  ["background", "foreground"],
  ["card", "card-foreground"],
  ["primary", "primary-foreground"],
  ["primary-soft", "primary"],
  ["accent", "accent-foreground"],
  ["accent-soft", "accent-foreground"],
  ["secondary", "secondary-foreground"],
  ["muted", "muted-foreground"],
  ["success", "success-foreground"],
  ["warning", "warning-foreground"],
  ["danger", "danger-foreground"],
  ["info", "info-foreground"],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

export default async function DesignSystemPage() {
  await requirePermission("design_system.view", "/design-system");

  return (
    <>
      <PageHeader
        title="Design system"
        description="TownMart tokens and components. Switch your OS to dark mode to check the dark theme."
      />
      <div className="flex flex-col gap-10">
        <Section title="Colour tokens">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {COLOR_TOKENS.map(([bg, fg]) => (
              <li
                key={bg}
                className="flex h-24 flex-col justify-end rounded-2xl border p-3 text-sm"
                style={{ background: `var(--${bg})`, color: `var(--${fg})` }}
              >
                <span className="font-semibold">{bg}</span>
                <span className="text-xs opacity-80">on {fg}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Typography">
          <Card className="flex flex-col gap-3 p-6">
            <p className="text-xs text-muted-foreground">Headings: Plus Jakarta Sans · Body: Inter</p>
            <h1 className="text-4xl font-extrabold">Everything your town sells</h1>
            <h2 className="text-2xl font-bold">Fresh tomatoes from Ogun</h2>
            <h3 className="text-lg font-semibold">Plumbing repairs in Ikeja</h3>
            <p>
              Body text sits at 16px on mobile so it stays readable on small screens. Prices always show in naira:{" "}
              <strong>{formatNaira(1_250_000n)}</strong>.
            </p>
            <p className="text-sm text-muted-foreground">Muted supporting text for hints and metadata.</p>
          </Card>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="accent">Accent CTA</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Info">
              <Info aria-hidden />
            </Button>
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="accent">-15% Promo</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="success">In stock</Badge>
            <Badge variant="warning">Low stock</Badge>
            <Badge variant="danger">Out of stock</Badge>
            <Badge variant="info">New</Badge>
            <Badge variant="outline">Outline</Badge>
          </div>
        </Section>

        <Section title="Alerts">
          <div className="grid gap-3">
            <Alert variant="info">Delivery to Lagos takes 1–2 days.</Alert>
            <Alert variant="success">Your order has been placed.</Alert>
            <Alert variant="warning">Only 3 left in stock.</Alert>
            <Alert variant="danger">Payment could not be verified.</Alert>
          </div>
        </Section>

        <Section title="Forms">
          <Card className="grid max-w-md gap-4 p-6">
            <FormField id="ds-name" label="Store name" hint="Shown on your storefront.">
              <Input placeholder="Mama Put Provisions" />
            </FormField>
            <FormField id="ds-email" label="Email" error="Enter a valid email address">
              <Input defaultValue="not-an-email" />
            </FormField>
          </Card>
        </Section>

        <Section title="Cards">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Card title</CardTitle>
                <CardDescription>rounded-2xl, soft shadow, 24px padding.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm">Card body content.</CardContent>
              <CardFooter>
                <Button size="sm">Action</Button>
              </CardFooter>
            </Card>
            <Card className="flex flex-col gap-3 p-6">
              <p className="text-sm text-muted-foreground">Loading skeleton</p>
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </Card>
          </div>
        </Section>

        <Separator />
        <p className="text-sm text-muted-foreground">Spacing follows an 8px grid (Tailwind steps of 2). Radius tokens: sm 8px, md 12px, lg 16px, xl 20px.</p>
      </div>
    </>
  );
}
