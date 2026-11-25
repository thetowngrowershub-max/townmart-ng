/**
 * Accounts on a deployed site (NODE_ENV=production): retiring the demo
 * accounts, and giving the owner's own account its staff role.
 *
 * The demo accounts (two staff logins, the demo shops' owners and the demo
 * shopper) used to be shared by every tester through a passwordless sign-in
 * page. That page is gone. On a deployed site the seed now suspends any demo
 * account it finds, signs it out everywhere and suspends its shops, so nobody
 * can use them and the demo shops leave the storefront. Nothing is deleted:
 * past orders keep their history, and an admin can restore a demo account or
 * shop from the console. SEED_DEMO_DATA=true keeps the old behaviour.
 */
import type { PrismaClient, Role } from "@prisma/client";
import { SELLERS } from "./data/demo-catalogue";

export const DEMO_STAFF_EMAILS = ["admin@townmart.local", "superadmin@townmart.local"];
export const DEMO_SHOPPER_EMAIL = "bola@demo.townmart.ng";

/** Every account the demo seed creates. */
export function demoAccountEmails(): string[] {
  return [...DEMO_STAFF_EMAILS, ...SELLERS.map((s) => s.owner.email), DEMO_SHOPPER_EMAIL];
}

export async function retireDemoAccounts(prisma: PrismaClient): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { in: demoAccountEmails() } },
    select: { id: true, email: true, status: true },
  });
  let accounts = 0;
  let shops = 0;
  for (const user of users) {
    await prisma.$transaction(async (tx) => {
      // Status changes on shops are guarded in the database: only admin or system scope may make them.
      await tx.$executeRaw`SELECT set_config('app.current_scope', 'system', true)`;
      if (user.status === "active") {
        await tx.user.update({ where: { id: user.id }, data: { status: "suspended" } });
        await tx.auditLog.create({
          data: { action: "user.demo_retired", entityType: "user", entityId: user.id, before: { status: user.status }, after: { status: "suspended" } },
        });
        accounts++;
      }
      // Always, so a session left over from the old demo sign-in can't linger.
      await tx.session.deleteMany({ where: { userId: user.id } });

      const businesses = await tx.business.findMany({
        where: { ownerUserId: user.id, status: { not: "suspended" } },
        select: { id: true, status: true },
      });
      for (const b of businesses) {
        await tx.business.update({ where: { id: b.id }, data: { status: "suspended" } });
        // Their made-up riders must never be offered a job (or texted).
        await tx.rider.updateMany({ where: { businessId: b.id }, data: { isAvailable: false } });
        await tx.auditLog.create({
          data: { action: "business.demo_retired", entityType: "business", entityId: b.id, before: { status: b.status }, after: { status: "suspended" } },
        });
        shops++;
      }
    });
  }
  if (users.length === 0) console.log("• No demo accounts on this site");
  else console.log(`✓ Demo accounts retired: ${accounts} suspended and ${shops} shops hidden this run (${users.length} demo accounts in all, none can sign in)`);
}

/**
 * Gives an existing account a staff role from the seed (SEED_SUPER_ADMIN_EMAIL,
 * SEED_ADMIN_EMAIL): the owner signs up like anyone else, confirms the email,
 * and the next deploy grants the role. Only ever adds a role; removing one is
 * done in the admin console.
 */
export async function grantRoleToExistingAccount(prisma: PrismaClient, email: string, role: Role, setting: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true, emailVerified: true, roles: { select: { role: true } } },
  });
  if (!user) return;
  if (user.roles.some((r) => r.role === role)) {
    console.log(`• ${setting}: ${email} already has ${role}`);
    return;
  }
  if (!user.emailVerified) {
    console.log(`• ${setting}: ${email} hasn't confirmed its email yet. Confirm it, then redeploy.`);
    return;
  }
  if (user.status !== "active") {
    console.log(`• ${setting}: ${email} isn't active, so no role was granted`);
    return;
  }
  await prisma.$transaction([
    prisma.userRole.create({ data: { userId: user.id, role } }),
    prisma.auditLog.create({ data: { action: "user.role_granted", entityType: "user", entityId: user.id, after: { role, by: setting } } }),
  ]);
  console.log(`✓ ${setting}: ${email} is now ${role}. Two-step sign-in is required before the admin console opens.`);
}
