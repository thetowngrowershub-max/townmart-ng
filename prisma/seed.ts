/**
 * Seeds reference data and platform accounts. Idempotent: safe to run repeatedly.
 * Runs as `townmart_migrator` (MIGRATE_DATABASE_URL), which owns the tables.
 *
 * Seeds 36 states + FCT and their 774 LGAs, default settings, the legal pages,
 * retention periods and RoPA (seed-legal.ts), one admin and one super admin,
 * then the catalogue: categories plus six demo sellers with products, services
 * and promotions (seed-catalogue.ts), and default delivery zones, rates and
 * commission (seed-delivery.ts), then demo orders, bookings and reviews
 * (seed-orders.ts), demo refunds, a dispute and a payout (seed-money.ts), and
 * attributes, help answers and pages, plus demo banners and questions (seed-content.ts).
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient, type Role } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";
import { slugify } from "../lib/slug";
import statesData from "./data/nigeria-states-lgas.json";
import { seedDemoCatalogue } from "./seed-catalogue";
import { seedContent, seedDemoContent } from "./seed-content";
import { seedCompliance } from "./seed-legal";
import { seedDeliveryAndCommission } from "./seed-delivery";
import { seedDemoMoney } from "./seed-money";
import { seedDemoOrders } from "./seed-orders";
import { demoAccountEmails, grantRoleToExistingAccount, retireDemoAccounts } from "./seed-accounts";

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) throw new Error("MIGRATE_DATABASE_URL is required to seed");
const prisma = new PrismaClient({ datasourceUrl: url });
const isProd = process.env.NODE_ENV === "production";

type StateRow = { code: string; name: string; lgas: string[] };

async function seedStatesAndLgas() {
  for (const s of statesData as StateRow[]) {
    const state = await prisma.state.upsert({
      where: { code: s.code },
      update: { name: s.name, slug: slugify(s.name) },
      create: { code: s.code, name: s.name, slug: slugify(s.name) },
    });
    await prisma.lga.createMany({
      data: s.lgas.map((name) => ({ stateId: state.id, name, slug: slugify(name) })),
      skipDuplicates: true,
    });
  }
  const [states, lgas] = await Promise.all([prisma.state.count(), prisma.lga.count()]);
  console.log(`✓ ${states} states and ${lgas} LGAs`);
}

/** Platform defaults. Admins change these from the console; the seed never overwrites them. */
const DEFAULT_SETTINGS: { key: string; value: unknown; description: string }[] = [
  { key: "escrow.release_days", value: 3, description: "Days after delivery before seller funds become available." },
  { key: "payments.pay_on_delivery_enabled", value: true, description: "Global switch for Pay on Delivery." },
  { key: "checkout.stock_hold_minutes", value: 15, description: "How long stock is reserved during checkout." },
  { key: "commission.default_percent", value: 5, description: "Default platform commission (%), before category/seller overrides." },
  { key: "fees.vat_percent", value: 7.5, description: "VAT rate (%) on TownMart's service fee." },
  { key: "fees.service_fee_percent", value: 1, description: "Service fee charged to shoppers (% of goods after discounts)." },
  { key: "fees.service_fee_cap_naira", value: 1000, description: "Maximum service fee per order (₦)." },
  { key: "bookings.lead_minutes", value: 120, description: "How soon a booking can start (minutes from now)." },
  { key: "bookings.days_ahead", value: 60, description: "How far ahead customers can book (days)." },
  { key: "delivery.per_km_naira", value: 250, description: "Delivery price per km from the shop to the customer (₦)." },
  { key: "orders.auto_complete_days", value: 7, description: "Days after delivery before an order completes if the customer doesn't confirm." },
  { key: "auth.max_failed_logins", value: 5, description: "Failed sign-ins before a temporary lockout." },
];

async function seedSettings() {
  for (const s of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: {},
      create: { key: s.key, value: s.value as never, description: s.description },
    });
  }
  console.log(`✓ ${DEFAULT_SETTINGS.length} default settings`);
}

const isLive = isProd && process.env.TOWNMART_TEST_MODE !== "true";
/** Demo shops, shopper and shared staff logins: always in development; on a deployed site only with SEED_DEMO_DATA=true. */
const withDemo = !isProd || process.env.SEED_DEMO_DATA === "true";

/**
 * Creates a staff account once. The email can be given (SEED_SUPER_ADMIN_EMAIL,
 * SEED_ADMIN_EMAIL), so a deployed site's staff are real people who receive
 * TownMart's emails. On a deployed site without demo data the email must be
 * given and can't be a demo account. If that account already exists (say the
 * owner signed up on the test site), it is given the role instead, once it has
 * confirmed its email. Two-step sign-in is then compulsory before the admin
 * console opens. Later runs leave the account alone.
 */
async function seedStaffAccount(defaultEmail: string, name: string, roles: Role[], prefix: string, opts: { requiredInProduction: boolean }) {
  const given = process.env[`${prefix}_EMAIL`]?.trim().toLowerCase();
  const passwordVar = `${prefix}_PASSWORD`;
  if (!withDemo) {
    if (!given) {
      if (isLive && opts.requiredInProduction) throw new Error(`${prefix}_EMAIL and ${passwordVar} must be set to create the first ${name} in production`);
      console.log(`• ${name} skipped (set ${prefix}_EMAIL to your own account's email)`);
      return;
    }
    if (demoAccountEmails().includes(given)) throw new Error(`${prefix}_EMAIL can't be a demo account (${given})`);
  }
  const email = given || defaultEmail;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (given) await grantRoleToExistingAccount(prisma, email, roles[0]!, `${prefix}_EMAIL`);
    else console.log(`• ${email} already exists (password unchanged)`);
    return;
  }
  let password = process.env[passwordVar];
  if (!password) {
    if (isProd) {
      if (isLive && opts.requiredInProduction) throw new Error(`${prefix}_EMAIL and ${passwordVar} must be set to create the first ${name} in production`);
      console.log(`• ${email} has no account yet: sign up with it and confirm the email, then redeploy (or set ${passwordVar} to create it)`);
      return;
    }
    password = randomBytes(12).toString("base64url");
  }
  if (isProd && password.length < 12) throw new Error(`${passwordVar} must be 12 characters or more`);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      emailVerified: new Date(),
      roles: { create: roles.map((role) => ({ role })) },
    },
  });
  await prisma.auditLog.create({
    data: { action: "user.seeded", entityType: "user", entityId: user.id, after: { roles } },
  });
  if (isProd) console.log(`✓ created ${email}`);
  else console.log(`✓ created ${email} / password: ${password}   (dev only — change it after first sign-in)`);
}

async function main() {
  await seedStatesAndLgas();
  await seedSettings();
  await seedCompliance(prisma);
  // Super admin first: with nothing else set, a live site's build stops here with what to add.
  await seedStaffAccount("superadmin@townmart.local", "TownMart Super Admin", ["super_admin", "customer"], "SEED_SUPER_ADMIN", { requiredInProduction: true });
  await seedStaffAccount("admin@townmart.local", "TownMart Admin", ["admin", "customer"], "SEED_ADMIN", { requiredInProduction: false });
  await seedDeliveryAndCommission(prisma);
  await seedDemoCatalogue(prisma);
  await seedContent(prisma);
  if (withDemo) {
    await seedDemoOrders(prisma);
    await seedDemoMoney(prisma);
    await seedDemoContent(prisma);
  } else {
    await retireDemoAccounts(prisma);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
