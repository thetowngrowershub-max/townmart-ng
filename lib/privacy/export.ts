import { createHmac, timingSafeEqual } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { daysFrom, getRetention } from "@/lib/compliance/retention";
import { decryptNullable } from "@/lib/crypto";
import { formatDateTime } from "@/lib/datetime";
import { withSystemContext, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { koboToNairaString } from "@/lib/money";
import { noticeTemplate } from "@/lib/notifications/email/templates";
import { enqueueEmail } from "@/lib/queue";
import { storage } from "@/lib/storage";

/**
 * Access and portability: everything TownMart holds about a person, as a
 * machine-readable JSON file and a readable PDF summary. Built by the
 * worker, stored in the private bucket, downloadable for 7 days (the
 * "data export download link" retention setting) through a signed link.
 */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const naira = (k: bigint) => koboToNairaString(k);
const tryDecrypt = (v: string | null | undefined) => {
  try {
    return decryptNullable(v);
  } catch {
    return null;
  }
};

export type PersonalDataExport = Awaited<ReturnType<typeof collectPersonalData>>;

export async function collectPersonalData(tx: Tx, userId: string) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      roles: true,
      accounts: { select: { provider: true, createdAt: true } },
      sessions: { select: { userAgent: true, createdAt: true, expires: true } },
      addresses: { include: { state: true, lga: true } },
      notificationPrefs: true,
      wishlistItems: { include: { product: { select: { title: true } }, service: { select: { title: true } } } },
      reviews: { select: { rating: true, body: true, authorName: true, status: true, sellerReply: true, createdAt: true, business: { select: { name: true } } } },
      notifications: { select: { title: true, body: true, createdAt: true, readAt: true }, orderBy: { createdAt: "desc" } },
      consentRecords: { orderBy: { createdAt: "asc" } },
      policyAcceptances: { include: { document: { select: { slug: true, title: true, version: true } } }, orderBy: { acceptedAt: "asc" } },
      dataRequests: { orderBy: { createdAt: "asc" } },
    },
  });
  // Guest orders placed with the same email are this person's too.
  const orders = await tx.order.findMany({
    where: { OR: [{ userId }, { contactEmail: user.email, isGuest: true }] },
    orderBy: { placedAt: "asc" },
    include: {
      sellerOrders: { include: { business: { select: { name: true } }, items: true, messages: { orderBy: { createdAt: "asc" } } } },
      refunds: { select: { refundNumber: true, reason: true, details: true, status: true, amountKobo: true, createdAt: true } },
    },
  });
  const bookings = await tx.booking.findMany({
    where: { customerUserId: userId },
    include: { service: { select: { title: true } }, business: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
  });

  return {
    generatedAt: new Date().toISOString(),
    controller: "TownMart",
    note: "All the personal data TownMart holds about you. Amounts are in naira. Times are UTC (ISO 8601).",
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerifiedAt: iso(user.emailVerified),
      phone: tryDecrypt(user.phoneEncrypted),
      phoneVerifiedAt: iso(user.phoneVerifiedAt),
      status: user.status,
      twoStepSignIn: user.twoFactorEnabledAt !== null,
      roles: user.roles.map((r) => r.role),
      signInWith: [...(user.passwordHash ? ["password"] : []), ...user.accounts.map((a) => a.provider)],
      createdAt: iso(user.createdAt),
      lastLoginAt: iso(user.lastLoginAt),
    },
    addresses: user.addresses.map((a) => ({
      label: a.label,
      recipientName: a.recipientName,
      phone: tryDecrypt(a.phoneEncrypted),
      line1: tryDecrypt(a.line1Encrypted),
      line2: tryDecrypt(a.line2Encrypted),
      landmark: a.landmark,
      city: a.city,
      lga: a.lga.name,
      state: a.state.name,
      isDefault: a.isDefault,
    })),
    orders: orders.map((o) => ({
      orderNumber: o.orderNumber,
      placedAt: iso(o.placedAt),
      contactEmail: o.contactEmail,
      contactPhone: tryDecrypt(o.contactPhoneEncrypted),
      customerName: o.customerName,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      total: naira(o.totalKobo),
      termsVersion: o.termsVersion,
      marketingConsent: o.marketingConsent,
      sellers: o.sellerOrders.map((so) => ({
        seller: so.business.name,
        status: so.status,
        deliveryMethod: so.deliveryMethod,
        items: so.items.map((i) => ({ title: (i.snapshot as { title?: string }).title ?? "Item", qty: i.qty.toString(), total: naira(i.lineTotalKobo) })),
        messages: so.messages.map((m) => ({ from: m.sender, body: m.body, at: iso(m.createdAt) })),
      })),
      refunds: o.refunds.map((r) => ({ number: r.refundNumber, reason: r.reason, details: r.details, status: r.status, amount: naira(r.amountKobo), at: iso(r.createdAt) })),
    })),
    bookings: bookings.map((b) => ({ service: b.service.title, provider: b.business.name, startsAt: iso(b.startsAt), status: b.status, price: naira(b.priceKobo) })),
    reviews: user.reviews.map((r) => ({ seller: r.business.name, rating: r.rating, review: r.body, shownAs: r.authorName, status: r.status, sellerReply: r.sellerReply, at: iso(r.createdAt) })),
    wishlist: user.wishlistItems.map((w) => w.product?.title ?? w.service?.title ?? "Removed listing"),
    notificationSettings: user.notificationPrefs
      ? {
          smsOrderUpdates: user.notificationPrefs.smsOrderUpdates,
          smsBookingReminders: user.notificationPrefs.smsBookingReminders,
          emailMessages: user.notificationPrefs.emailMessages,
          marketingEmail: user.notificationPrefs.marketingEmail,
          marketingSms: user.notificationPrefs.marketingSms,
        }
      : null,
    notifications: user.notifications.map((n) => ({ title: n.title, body: n.body, at: iso(n.createdAt), read: n.readAt !== null })),
    cookieChoices: user.consentRecords.map((c) => ({ functional: c.functional, analytics: c.analytics, marketing: c.marketing, policyVersion: c.policyVersion, at: iso(c.createdAt) })),
    agreements: user.policyAcceptances.map((a) => ({ document: a.document.title, version: a.document.version, context: a.context, at: iso(a.acceptedAt) })),
    signedInDevices: user.sessions.map((s) => ({ device: s.userAgent, since: iso(s.createdAt), until: iso(s.expires) })),
    dataRequests: user.dataRequests.map((d) => ({ reference: d.reference, type: d.type, status: d.status, at: iso(d.createdAt), completedAt: iso(d.completedAt) })),
  };
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

const MARGIN = 50;
const PAGE: [number, number] = [595.28, 841.89]; // A4

/** Standard PDF fonts only cover Latin-1; swap the naira sign and smart quotes. */
const pdfSafe = (s: string) =>
  s
    .replace(/₦/g, "NGN ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "?");

class PdfWriter {
  private page!: PDFPage;
  private y = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
  ) {
    this.newPage();
  }
  private newPage() {
    this.page = this.doc.addPage(PAGE);
    this.y = PAGE[1] - MARGIN;
  }
  private wrap(text: string, size: number, font: PDFFont, width: number): string[] {
    const lines: string[] = [];
    for (const para of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }
  text(text: string, opts: { size?: number; bold?: boolean; indent?: number; gap?: number; color?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = MARGIN + (opts.indent ?? 0);
    for (const line of this.wrap(text, size, font, PAGE[0] - MARGIN - x)) {
      if (this.y < MARGIN + size) this.newPage();
      this.page.drawText(line, { x, y: this.y - size, size, font, color: rgb(opts.color ?? 0.1, opts.color ?? 0.1, opts.color ?? 0.1) });
      this.y -= size * 1.4;
    }
    this.y -= opts.gap ?? 2;
  }
  heading(text: string) {
    this.y -= 8;
    this.text(text, { size: 14, bold: true, gap: 6 });
  }
  field(label: string, value: unknown) {
    if (value === null || value === undefined || value === "") return;
    this.text(`${label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`, { indent: 10 });
  }
}

const when = (s: string | null) => (s ? formatDateTime(new Date(s)) : null);

export async function buildExportPdf(data: PersonalDataExport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Your TownMart data");
  doc.setCreator("TownMart");
  const w = new PdfWriter(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  w.text("Your TownMart data", { size: 20, bold: true, gap: 4 });
  w.text(`Prepared ${when(data.generatedAt)} (Lagos time). The JSON file has the same data in a machine-readable format.`, { color: 0.4, gap: 10 });

  w.heading("Profile");
  const p = data.profile;
  w.field("Name", p.name);
  w.field("Email", p.email);
  w.field("Phone", p.phone);
  w.field("Account status", p.status);
  w.field("Signs in with", p.signInWith);
  w.field("Two-step sign-in", p.twoStepSignIn ? "On" : "Off");
  w.field("Joined", when(p.createdAt));
  w.field("Last sign-in", when(p.lastLoginAt));

  w.heading(`Addresses (${data.addresses.length})`);
  for (const a of data.addresses) w.text(`${a.label ?? "Address"}: ${a.recipientName}, ${[a.line1, a.line2, a.city, a.lga, a.state].filter(Boolean).join(", ")}${a.phone ? `, ${a.phone}` : ""}`, { indent: 10 });

  w.heading(`Orders (${data.orders.length})`);
  for (const o of data.orders) {
    w.text(`${o.orderNumber} · ${when(o.placedAt)} · NGN ${o.total} · ${o.paymentStatus}`, { bold: true, indent: 10 });
    for (const s of o.sellers) w.text(`${s.seller} (${s.status}): ${s.items.map((i) => `${i.qty} x ${i.title}`).join("; ")}`, { indent: 20 });
    for (const r of o.refunds) w.text(`Refund ${r.number}: NGN ${r.amount}, ${r.status}`, { indent: 20 });
  }

  w.heading(`Bookings (${data.bookings.length})`);
  for (const b of data.bookings) w.text(`${b.service} with ${b.provider} · ${when(b.startsAt)} · ${b.status}`, { indent: 10 });

  w.heading(`Reviews (${data.reviews.length})`);
  for (const r of data.reviews) w.text(`${r.seller}, ${r.rating}/5: ${r.review}`, { indent: 10 });

  w.heading("Settings and consent");
  if (data.notificationSettings) {
    const n = data.notificationSettings;
    w.field("Order updates by SMS", n.smsOrderUpdates ? "On" : "Off");
    w.field("Booking reminders by SMS", n.smsBookingReminders ? "On" : "Off");
    w.field("Marketing email", n.marketingEmail ? "On" : "Off");
  }
  for (const c of data.cookieChoices) w.text(`Cookie choice ${when(c.at)}: functional ${c.functional ? "on" : "off"}, analytics ${c.analytics ? "on" : "off"}, marketing ${c.marketing ? "on" : "off"}`, { indent: 10 });
  for (const a of data.agreements) w.text(`Accepted ${a.document} (version ${a.version}) on ${when(a.at)}`, { indent: 10 });

  w.heading("Data requests");
  for (const d of data.dataRequests) w.text(`${d.reference}: ${d.type}, ${d.status}`, { indent: 10 });

  w.heading("What else we keep");
  w.text("Order, payment and refund records are kept for six years because tax and accounting law requires it, even after an account is deleted. Messages and notifications are listed in the JSON file.");
  return doc.save();
}

// ─── Building and downloading ───────────────────────────────────────────────

export const exportKeys = (requestId: string) => ({ json: `exports/${requestId}/townmart-data.json`, pdf: `exports/${requestId}/townmart-data.pdf` });

/** Worker job: builds the files, stores them, completes the request and emails the link. */
export async function buildDataExport(requestId: string): Promise<"done" | "skipped"> {
  const req = await withSystemContext((tx) => tx.dataSubjectRequest.findUnique({ where: { id: requestId } }));
  if (!req || !req.userId || !["access", "portability"].includes(req.type) || req.status === "completed" || req.status === "cancelled") return "skipped";
  const userId = req.userId;
  const data = await withSystemContext((tx) => collectPersonalData(tx, userId));
  const keys = exportKeys(requestId);
  await storage().putObject("private", keys.json, Buffer.from(JSON.stringify(data, null, 2)), "application/json");
  await storage().putObject("private", keys.pdf, Buffer.from(await buildExportPdf(data)), "application/pdf");
  const expiresAt = await withSystemContext(async (tx) => {
    const now = new Date();
    const expiresAt = daysFrom((await getRetention(tx)).export_link, now);
    await tx.dataSubjectRequest.update({
      where: { id: requestId },
      data: { status: "completed", completedAt: now, exportJsonKey: keys.json, exportPdfKey: keys.pdf, exportExpiresAt: expiresAt, resolutionNote: "Export prepared automatically." },
    });
    return expiresAt;
  });
  await enqueueEmail(
    noticeTemplate({
      to: req.email,
      subject: `Your TownMart data is ready · ${req.reference}`,
      title: "Your data is ready to download",
      lines: [
        `Hi${req.name ? ` ${req.name}` : ""},`,
        `The copy of your data you asked for (${req.reference}) is ready: a PDF to read and a JSON file you can take to another service.`,
        `The download link works until ${formatDateTime(expiresAt)} and only when you're signed in to TownMart.`,
      ],
      url: exportDownloadUrl(requestId, "pdf", expiresAt),
      buttonLabel: "Download your data",
    }),
  );
  return "done";
}

const sig = (requestId: string, file: string, exp: number) => createHmac("sha256", env().AUTH_SECRET).update(`export:${requestId}:${file}:${exp}`).digest("base64url");

/** A signed download link, valid until the export expires. The route also requires the owner to be signed in. */
export function exportDownloadUrl(requestId: string, file: "json" | "pdf", expiresAt: Date): string {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const url = new URL(`/api/privacy/export/${requestId}`, env().APP_URL);
  url.searchParams.set("f", file);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", sig(requestId, file, exp));
  return url.toString();
}

export function verifyExportLink(requestId: string, file: string, exp: string | null, given: string | null, now = new Date()): boolean {
  if (!exp || !given || !/^\d+$/.test(exp) || (file !== "json" && file !== "pdf")) return false;
  if (Number(exp) * 1000 < now.getTime()) return false;
  const a = Buffer.from(sig(requestId, file, Number(exp)));
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Deletes export files whose download window has closed. */
export async function purgeExpiredExports(now = new Date()): Promise<{ purged: number }> {
  const due = await withSystemContext((tx) =>
    tx.dataSubjectRequest.findMany({ where: { exportExpiresAt: { lt: now }, OR: [{ exportJsonKey: { not: null } }, { exportPdfKey: { not: null } }] }, select: { id: true, exportJsonKey: true, exportPdfKey: true } }),
  );
  for (const r of due) {
    for (const key of [r.exportJsonKey, r.exportPdfKey]) if (key) await storage().deleteObject("private", key);
    await withSystemContext((tx) => tx.dataSubjectRequest.update({ where: { id: r.id }, data: { exportJsonKey: null, exportPdfKey: null } }));
  }
  return { purged: due.length };
}

