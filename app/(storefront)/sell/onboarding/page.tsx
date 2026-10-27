import { Check, Circle, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandingForm } from "@/components/seller/onboarding/branding-form";
import { BusinessDetailsForm } from "@/components/seller/onboarding/business-details-form";
import { IdentityForm } from "@/components/seller/onboarding/identity-form";
import { PayoutForm } from "@/components/seller/onboarding/payout-form";
import { PhoneStep } from "@/components/seller/onboarding/phone-step";
import { SubmitForm } from "@/components/seller/onboarding/submit-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";
import { withRls } from "@/lib/db";
import { env } from "@/lib/env";
import { currentDocuments } from "@/lib/legal/documents";
import { bankVerifier } from "@/lib/payments/banks";
import { EDITABLE_STATUSES, getOnboardingState, nextStep, ONBOARDING_STEPS, STEP_LABELS, type OnboardingStep } from "@/lib/seller/onboarding";
import { publicImageUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Seller application", robots: { index: false } };

const STEP_HELP: Record<OnboardingStep, string> = {
  details: "Who you are and where you trade. Your street address stays private.",
  phone: "Confirm the number customers and our team can reach you on.",
  identity: "A government ID for the owner, or your CAC certificate.",
  payout: "Where we send your earnings. We check the account name with your bank.",
  branding: "How your store looks to shoppers.",
  submit: "Read and accept the agreements, then send your application.",
};

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=/sell/onboarding");
  if (!can(user, "seller.onboard")) redirect("/dashboard");

  const state = await getOnboardingState(user.id);
  const b = state.business;
  const editable = !b || EDITABLE_STATUSES.includes(b.status);

  if (b && !editable) return <StatusView status={b.status} name={b.name} slug={b.slug} />;

  // A step can be opened once every step before it is done.
  const firstOpen = nextStep(state.done);
  const requested = (await searchParams).step as OnboardingStep | undefined;
  const reachable = (s: OnboardingStep) => ONBOARDING_STEPS.indexOf(s) <= ONBOARDING_STEPS.indexOf(firstOpen);
  const step = requested && ONBOARDING_STEPS.includes(requested) && reachable(requested) ? requested : firstOpen;
  const versions =
    step === "submit"
      ? Object.fromEntries([...(await withRls({ userId: user.id }, (tx) => currentDocuments(tx, ["seller-agreement", "dpa"])))].map(([slug, d]) => [slug, d.version]))
      : {};

  const host = new URL(env().APP_URL).host;
  const states =
    step === "details"
      ? await withRls({ userId: user.id }, (tx) =>
          tx.state.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, lgas: { orderBy: { name: "asc" }, select: { id: true, name: true } } } }),
        )
      : [];
  const banks = step === "payout" ? await bankVerifier().listBanks().catch(() => null) : [];

  return (
    <main id="main" className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[240px_1fr]">
      <div className="lg:col-span-2">
        <h1 className="text-2xl font-bold sm:text-3xl">Become a TownMart seller</h1>
        <p className="mt-1 text-muted-foreground">Your progress is saved after each step.</p>
      </div>
      <nav aria-label="Application steps">
        <ol className="flex flex-col gap-1">
          {ONBOARDING_STEPS.map((s, i) => {
            const done = state.done[s];
            const open = reachable(s);
            const content = (
              <>
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                    done ? "border-primary bg-primary text-primary-foreground" : s === step ? "border-primary text-primary" : "",
                  )}
                  aria-hidden
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                {STEP_LABELS[s]}
                {done && <span className="sr-only">(done)</span>}
              </>
            );
            const cls = cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm", s === step && "bg-muted font-semibold");
            return (
              <li key={s}>
                {open ? (
                  <Link href={`/sell/onboarding?step=${s}`} className={cls} aria-current={s === step ? "step" : undefined}>
                    {content}
                  </Link>
                ) : (
                  <span className={cn(cls, "text-muted-foreground")}>{content}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>{STEP_LABELS[step]}</CardTitle>
          <CardDescription>{STEP_HELP[step]}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {b?.status === "rejected" && b.rejectionReason && (
            <Alert variant="warning">
              <strong>Our team asked for changes:</strong> {b.rejectionReason}
            </Alert>
          )}
          {state.kyc?.status === "failed" && step === "identity" && state.kyc.notes && (
            <Alert variant="warning">
              <strong>We couldn&apos;t verify your documents:</strong> {state.kyc.notes}
            </Alert>
          )}
          {!user.emailVerified && step === "details" && (
            <Alert variant="warning">
              Please <Link href="/account/security">confirm your email address</Link> before you start.
            </Alert>
          )}
          {step === "details" && (
            <BusinessDetailsForm
              states={states}
              appHost={host}
              initial={
                b
                  ? {
                      type: b.type as never,
                      name: b.name,
                      slug: b.slug,
                      cacNumber: b.cacNumber ?? "",
                      email: b.email,
                      phone: b.phone,
                      addressLine: b.addressLine,
                      city: b.city,
                      stateId: b.stateId,
                      lgaId: b.lgaId,
                      sellsProducts: b.sellsProducts,
                      sellsServices: b.sellsServices,
                    }
                  : { email: user.email }
              }
            />
          )}
          {step === "phone" && b && (state.done.phone ? <Alert variant="success">{b.phoneMasked} is verified.</Alert> : <PhoneStep phoneMasked={b.phoneMasked} />)}
          {step === "identity" &&
            (state.done.identity ? (
              <>
                <Alert variant="success">
                  {state.kyc?.documentCount} document{state.kyc?.documentCount === 1 ? "" : "s"} received. Our team checks them when reviewing your
                  application.
                </Alert>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">Replace documents</summary>
                  <div className="mt-4">
                    <IdentityForm resubmitting />
                  </div>
                </details>
              </>
            ) : (
              <IdentityForm resubmitting={state.kyc?.status === "failed"} />
            ))}
          {step === "payout" &&
            (banks ? (
              <PayoutForm banks={banks} current={state.payout} />
            ) : (
              <Alert variant="danger">We couldn&apos;t load the list of banks. Please refresh the page in a minute.</Alert>
            ))}
          {step === "branding" && b && (
            <BrandingForm
              initial={{
                description: b.description ?? "",
                logo: b.logoKey ? { key: b.logoKey, url: publicImageUrl(b.logoKey) } : null,
                banner: b.bannerKey ? { key: b.bannerKey, url: publicImageUrl(b.bannerKey) } : null,
              }}
            />
          )}
          {step === "submit" && (
            <SubmitForm
              ready={(["details", "phone", "identity", "payout", "branding"] as const).every((s) => state.done[s])}
              versions={versions}
              services={b?.sellsServices ?? false}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function StatusView({ status, name, slug }: { status: string; name: string; slug: string }) {
  const view =
    status === "approved"
      ? { icon: Check, title: `${name} is live`, body: "Your store is approved. Add products and services from your dashboard.", cta: { href: "/dashboard", label: "Go to dashboard" } }
      : status === "suspended"
        ? { icon: Circle, title: `${name} is suspended`, body: "Your listings are hidden. Check your email for the reason, or contact support.", cta: { href: "/dashboard", label: "Go to dashboard" } }
        : {
            icon: Clock,
            title: status === "under_review" ? "We're reviewing your application" : "Application received",
            body: "We usually decide within 2 working days and will email you. Meanwhile you can add listings; they go live when you're approved.",
            cta: { href: "/dashboard", label: "Start adding listings" },
          };
  const Icon = view.icon;
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <Card>
        <CardHeader className="items-start gap-3">
          <Icon className="size-8 text-primary" aria-hidden />
          <CardTitle className="text-2xl">{view.title}</CardTitle>
          <CardDescription>{view.body}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={view.cta.href}>{view.cta.label}</Link>
          </Button>
          {status === "approved" && (
            <Button asChild variant="outline">
              <Link href={`/store/${slug}`}>View your store</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
