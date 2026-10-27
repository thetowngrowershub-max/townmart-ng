import type { LawfulBasis, PrismaClient } from "@prisma/client";
import { RETENTION_DEFAULTS, RETENTION_KEYS } from "../lib/compliance/retention";
import { INITIAL_LEGAL_VERSION, LEGAL_TEMPLATES, templateHtml } from "./legal-templates";

/**
 * Compliance starting points: the first version of every legal page, the
 * retention periods, and a record of processing activities and processors
 * to review and complete in the compliance centre. Only adds what is
 * missing; edits made in the console are never overwritten.
 */
export async function seedCompliance(prisma: PrismaClient) {
  const effectiveAt = new Date("2026-10-01T00:00:00+01:00");
  for (const t of LEGAL_TEMPLATES) {
    await prisma.legalDocument.upsert({
      where: { slug_version: { slug: t.slug, version: INITIAL_LEGAL_VERSION } },
      update: {},
      create: { slug: t.slug, version: INITIAL_LEGAL_VERSION, title: t.title, summary: t.summary, bodyHtml: templateHtml(t), effectiveAt, isTemplate: true },
    });
  }

  await prisma.retentionSetting.createMany({
    data: RETENTION_KEYS.map((key) => ({ key, ...RETENTION_DEFAULTS[key] })),
    skipDuplicates: true,
  });

  if ((await prisma.processingActivity.count()) === 0) {
    await prisma.processingActivity.createMany({ data: ACTIVITIES.map((a, i) => ({ ...a, sortOrder: i })) });
  }
  await prisma.dataProcessor.createMany({ data: PROCESSORS, skipDuplicates: true });
  if ((await prisma.dpiaRecord.count()) === 0) {
    const kyc = await prisma.processingActivity.findFirst({ where: { name: "Seller verification" } });
    await prisma.dpiaRecord.create({
      data: {
        title: "Seller identity verification",
        activityId: kyc?.id ?? null,
        description: "Sellers upload identity and business documents, which TownMart staff review before a shop goes live.",
        risks: "Identity documents are sensitive: a leak could enable identity fraud. Staff could view more documents than they need.",
        mitigations: "Documents are kept in a private bucket and opened only through short-lived links by staff with the KYC permission; every view is audit-logged. Identity-check references are encrypted; raw BVN/NIN is never stored.",
        residualRisk: "medium",
        status: "draft",
      },
    });
  }
  console.log(`✓ ${LEGAL_TEMPLATES.length} legal pages, retention periods, RoPA and processors`);
}

const ACTIVITIES: { name: string; purpose: string; lawfulBasis: LawfulBasis; dataSubjects: string[]; dataCategories: string[]; recipients: string[]; transfers: string | null; retention: string; security: string }[] = [
  {
    name: "Customer accounts",
    purpose: "Create and run shopper accounts, sign-in and security.",
    lawfulBasis: "contract",
    dataSubjects: ["Customers"],
    dataCategories: ["Name", "Email", "Phone", "Password hash", "Sessions"],
    recipients: ["Email provider", "SMS provider", "Hosting"],
    transfers: null,
    retention: "While the account is open; anonymised after the deletion grace period. Unconfirmed accounts deleted after the configured period.",
    security: "Argon2id passwords, encrypted phone numbers, optional two-step sign-in, session revocation, lockout.",
  },
  {
    name: "Orders and bookings",
    purpose: "Take orders and bookings, pass what sellers need to fulfil them, handle returns and refunds.",
    lawfulBasis: "contract",
    dataSubjects: ["Customers", "Guests"],
    dataCategories: ["Name", "Email", "Phone", "Delivery address", "Order history"],
    recipients: ["Sellers (name, phone, address only)", "Payment providers", "Delivery partners"],
    transfers: null,
    retention: "Six years for tax and accounting.",
    security: "Encrypted phone and address lines; sellers see only their part; phone hidden from sellers after the configured period.",
  },
  {
    name: "Payments, payouts and accounting",
    purpose: "Take payments, refund customers, pay sellers and keep the ledger.",
    lawfulBasis: "legal_obligation",
    dataSubjects: ["Customers", "Sellers"],
    dataCategories: ["Payment references", "Bank account name and last 4 digits", "Transaction amounts"],
    recipients: ["Paystack", "Flutterwave"],
    transfers: null,
    retention: "Six years.",
    security: "No card data stored; append-only ledger; payment webhooks verified by signature.",
  },
  {
    name: "Seller verification",
    purpose: "Verify sellers' identity, business and bank account before they can sell.",
    lawfulBasis: "legal_obligation",
    dataSubjects: ["Sellers", "Business owners"],
    dataCategories: ["ID documents", "CAC number", "Identity-check reference", "Business phone and address"],
    recipients: ["TownMart staff with KYC permission"],
    transfers: null,
    retention: "While the shop is active and six years after it closes.",
    security: "Private bucket, short-lived links, audit log of every view, encrypted references.",
  },
  {
    name: "Customer support and disputes",
    purpose: "Answer questions, decide disputes and keep a record of decisions.",
    lawfulBasis: "legitimate_interests",
    dataSubjects: ["Customers", "Sellers"],
    dataCategories: ["Messages", "Evidence photos", "Order details"],
    recipients: ["Sellers involved in the order"],
    transfers: null,
    retention: "Six years with the order.",
    security: "Access limited to staff with the dispute permission; evidence in the private bucket.",
  },
  {
    name: "Marketing",
    purpose: "Send offers by email or SMS to people who opted in.",
    lawfulBasis: "consent",
    dataSubjects: ["Customers", "Guests who opted in"],
    dataCategories: ["Name", "Email", "Phone"],
    recipients: ["Email provider", "SMS provider"],
    transfers: null,
    retention: "Until consent is withdrawn; unsubscribed addresses kept on a suppression list so they are never contacted again.",
    security: "One-click unsubscribe in every message.",
  },
  {
    name: "Analytics cookies",
    purpose: "Understand, in aggregate, how the site is used.",
    lawfulBasis: "consent",
    dataSubjects: ["Visitors"],
    dataCategories: ["Pseudonymised device and usage data"],
    recipients: ["Analytics provider (only after consent)"],
    transfers: null,
    retention: "Consent records kept as proof; analytics data per the provider's settings.",
    security: "Scripts load only after consent; IPs hashed in our own records.",
  },
];

const PROCESSORS = [
  { name: "Paystack", service: "Card and bank payments, refunds, transfers to sellers", dataCategories: ["Name", "Email", "Payment details"], location: "Nigeria", safeguards: null, website: "https://paystack.com" },
  { name: "Flutterwave", service: "Card and bank payments (alternative provider)", dataCategories: ["Name", "Email", "Payment details"], location: "Nigeria", safeguards: null, website: "https://flutterwave.com" },
  { name: "Cloudflare", service: "Turnstile bot checks on sign-up and forms", dataCategories: ["IP address", "Browser signals"], location: "Global network (USA HQ)", safeguards: "Standard contractual clauses; record the transfer basis here.", website: "https://www.cloudflare.com" },
  { name: "Email provider", service: "Receipts, account and order emails (set the provider used in production)", dataCategories: ["Name", "Email"], location: "To be confirmed", safeguards: "To be confirmed before launch.", website: null },
  { name: "SMS provider", service: "Sign-in codes and order updates (set the provider used in production)", dataCategories: ["Phone"], location: "To be confirmed", safeguards: "To be confirmed before launch.", website: null },
  { name: "Hosting provider", service: "Servers, database and file storage (set the provider used in production)", dataCategories: ["All personal data TownMart holds"], location: "To be confirmed", safeguards: "To be confirmed before launch.", website: null },
  { name: "Google", service: "Optional \"Continue with Google\" sign-in", dataCategories: ["Name", "Email", "Profile photo"], location: "USA", safeguards: "Standard contractual clauses; record the transfer basis here.", website: "https://policies.google.com/privacy" },
];
