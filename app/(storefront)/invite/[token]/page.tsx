import type { Metadata } from "next";
import Link from "next/link";
import { AcceptInvitationButton } from "@/components/seller/staff-forms";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { sha256 } from "@/lib/crypto";
import { withSystemContext } from "@/lib/db";
import { STAFF_FLAGS } from "@/lib/staff/flags";
import { AuthCard } from "../../auth/auth-card";

export const metadata: Metadata = { title: "Staff invitation", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{20,100}$/.test(token);
  // Looked up by the hash of the link's token; the invitee has no store context yet.
  const inv = valid
    ? await withSystemContext((tx) => tx.staffInvitation.findUnique({ where: { tokenHash: sha256(token) }, select: { email: true, permissions: true, expiresAt: true, acceptedAt: true, revokedAt: true, business: { select: { name: true } } } }))
    : null;
  const user = await getCurrentUser();
  const problem = !inv || inv.revokedAt ? "This invitation isn't valid. It may have been cancelled or replaced by a newer email." : inv.acceptedAt ? "This invitation has already been used." : inv.expiresAt <= new Date() ? "This invitation has expired. Ask the store to send it again." : null;

  if (!inv || problem)
    return (
      <AuthCard title="Staff invitation">
        <Alert variant="warning">{problem}</Alert>
      </AuthCard>
    );

  const flags = inv.permissions as Record<string, boolean>;
  const next = `/invite/${token}`;
  return (
    <AuthCard title={`Join ${inv.business.name}`} description={`You've been invited to help run ${inv.business.name} on TownMart.`}>
      <div className="flex flex-col gap-4 text-sm">
        <div>
          <p className="mb-2 font-medium">You&apos;ll be able to work on:</p>
          <ul className="list-disc pl-5">
            {STAFF_FLAGS.filter((f) => flags[f.key]).map((f) => (
              <li key={f.key}>
                {f.label}: <span className="text-muted-foreground">{f.hint}</span>
              </li>
            ))}
          </ul>
        </div>
        {!user ? (
          <>
            <p>
              Sign in with <strong>{inv.email}</strong> to accept. New to TownMart? Create an account with that email, then open this link again.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href={`/auth/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/auth/sign-up">Create an account</Link>
              </Button>
            </div>
          </>
        ) : user.email.toLowerCase() !== inv.email.toLowerCase() ? (
          <Alert variant="warning">
            This invitation is for {inv.email}, but you&apos;re signed in as {user.email}. Sign out and sign in with {inv.email} to accept.
          </Alert>
        ) : (
          <AcceptInvitationButton token={token} />
        )}
      </div>
    </AuthCard>
  );
}
