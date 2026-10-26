/**
 * Seeds reference data and platform accounts. Idempotent: safe to run repeatedly.
 * Runs as `townmart_migrator` (MIGRATE_DATABASE_URL), which owns the tables.
 *
 * Seeds 36 states + FCT and their 774 LGAs, default settings, one admin and one
 * super admin, then the catalogue: categories plus six demo sellers with
 * products, services and promotions (seed-catalogue.ts), and default delivery
 * zones, rates and commission (seed-delivery.ts), then demo orders, bookings
 * and reviews (seed-orders.ts), and demo refunds, a dispute and a payout
 * (seed-money.ts).
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient, type Role } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";
import { slugify } from "../lib/slug";
import statesData from "./data/nigeria-states-lgas.json";
import { seedDemoCatalogue } from "./seed-catalogue";
import { seedDeliveryAndCommission } from "./seed-delivery";
import { seedDemoMoney } from "./seed-money";
import { seedDemoOrders } from "./seed-orders";

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
  { key: "orders.auto_complete_days", value: 7, description: "Days after delivery before an order completes if the customer doesn't confirm." },
  { key: "auth.max_failed_logins", value: 5, description: "Failed sign-ins before a temporary lockout." },
  { key: "dsr.response_days", value: 30, description: "Deadline for data subject requests (days)." },
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

async function seedStaffAccount(email: string, name: string, roles: Role[], envVar: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`• ${email} already exists (password unchanged)`);
    return;
  }
  let password = process.env[envVar];
  if (!password) {
    if (isProd) throw new Error(`${envVar} must be set to seed ${email} in production`);
    password = randomBytes(12).toString("base64url");
  }
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
  await seedStaffAccount("admin@townmart.local", "TownMart Admin", ["admin", "customer"], "SEED_ADMIN_PASSWORD");
  await seedStaffAccount("superadmin@townmart.local", "TownMart Super Admin", ["super_admin", "customer"], "SEED_SUPER_ADMIN_PASSWORD");
  await seedDeliveryAndCommission(prisma);
  await seedDemoCatalogue(prisma);
  if (!isProd || process.env.SEED_DEMO_DATA === "true") {
    await seedDemoOrders(prisma);
    await seedDemoMoney(prisma);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
