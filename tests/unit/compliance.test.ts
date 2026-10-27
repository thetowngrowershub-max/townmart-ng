import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { decodePending, encodePending } from "@/lib/auth/two-factor";
import { breachNoticeTemplate, formatDuration, ndpcClock } from "@/lib/compliance/breach";
import { allowedScripts, type Consent, needsConsent, parseConsent, serialiseConsent } from "@/lib/consent/cookie";
import { fillPlaceholders, nextVersion } from "@/lib/legal/documents";
import { unsubscribeUrl, verifyUnsubscribe } from "@/lib/marketing";
import { buildExportPdf, exportDownloadUrl, type PersonalDataExport, verifyExportLink } from "@/lib/privacy/export";
import { deadline } from "@/lib/privacy/requests";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date("2026-11-14T10:00:00+01:00");

describe("consent cookie", () => {
  const consent: Consent = { subjectId: randomUUID(), functional: true, analytics: false, marketing: true, version: "2026-10-draft", at: new Date(Math.floor(now.getTime() / 1000) * 1000) };

  it("round-trips and rejects anything malformed", () => {
    expect(parseConsent(serialiseConsent(consent))).toEqual(consent);
    expect(parseConsent(undefined)).toBeNull();
    expect(parseConsent("not-a-uuid.101.v.1")).toBeNull();
    expect(parseConsent(`${consent.subjectId}.12.v.1`)).toBeNull();
    expect(parseConsent(`${consent.subjectId}.101..1`)).toBeNull();
    expect(parseConsent(`${consent.subjectId}.101.v.soon`)).toBeNull();
  });

  it("asks again with no choice, after 12 months, or when the Cookie Policy changes", () => {
    expect(needsConsent(null, "2026-10-draft", now)).toBe(true);
    expect(needsConsent(consent, "2026-10-draft", now)).toBe(false);
    expect(needsConsent(consent, "2026-10-draft", new Date(now.getTime() + 366 * DAY))).toBe(true);
    expect(needsConsent(consent, "2026-12-01", now)).toBe(true);
  });

  it("loads only the scripts the visitor allowed, and none before a current choice", () => {
    const scripts = { analytics: "https://a.example/a.js", marketing: "https://m.example/m.js" };
    expect(allowedScripts(null, "2026-10-draft", scripts, now)).toEqual([]);
    expect(allowedScripts(consent, "2026-10-draft", scripts, now)).toEqual([scripts.marketing]);
    expect(allowedScripts({ ...consent, analytics: true }, "2026-10-draft", scripts, now)).toEqual([scripts.analytics, scripts.marketing]);
    expect(allowedScripts({ ...consent, analytics: true }, "2026-12-01", scripts, now)).toEqual([]);
    expect(allowedScripts({ ...consent, analytics: true }, "2026-10-draft", {}, now)).toEqual([]);
  });
});

describe("legal document versions and placeholders", () => {
  it("labels a version by its Lagos effective date, with a suffix when taken", () => {
    // 23:30 UTC is already the next day in Lagos.
    const at = new Date("2026-11-13T23:30:00Z");
    expect(nextVersion([], at)).toBe("2026-11-14");
    expect(nextVersion(["2026-11-14"], at)).toBe("2026-11-14-2");
    expect(nextVersion(["2026-11-14", "2026-11-14-2"], at)).toBe("2026-11-14-3");
  });

  it("fills known values escaped, and marks missing ones instead of leaving a blank", () => {
    const { html, missing } = fillPlaceholders("<p>{{company.legal_name}}, RC {{ company.rc_number }}; carts kept {{retention.abandoned_carts}} days</p>", {
      "company.legal_name": "Town <Growers> & Co",
      "company.rc_number": null,
      "retention.abandoned_carts": "30",
    });
    expect(html).toBe("<p>Town &lt;Growers&gt; &amp; Co, RC <mark>[company.rc_number not set]</mark>; carts kept 30 days</p>");
    expect(missing).toEqual(["company.rc_number"]);
  });
});

describe("breach register", () => {
  const awareAt = new Date("2026-11-10T09:00:00Z");

  it("counts down 72 hours from awareness and records whether NDPC was told in time", () => {
    const running = ndpcClock({ awareAt, ndpcNotifiedAt: null }, new Date(awareAt.getTime() + 30 * HOUR + 55 * 60_000));
    expect(running).toMatchObject({ state: "running", msLeft: 41 * HOUR + 5 * 60_000 });
    expect(formatDuration(running.state === "running" ? running.msLeft : 0)).toBe("41h 05m");
    expect(ndpcClock({ awareAt, ndpcNotifiedAt: null }, new Date(awareAt.getTime() + 80 * HOUR))).toMatchObject({ state: "overdue", msLate: 8 * HOUR });
    expect(ndpcClock({ awareAt, ndpcNotifiedAt: new Date(awareAt.getTime() + 70 * HOUR) })).toMatchObject({ state: "notified", onTime: true });
    expect(ndpcClock({ awareAt, ndpcNotifiedAt: new Date(awareAt.getTime() + 73 * HOUR) })).toMatchObject({ state: "notified", onTime: false });
  });

  it("drafts a notice for the people affected, with gaps marked", () => {
    const company = { legal_name: null, rc_number: null, address: null, support_email: null, support_phone: null, dpo_name: null, dpo_email: "dpo@townmart.ng", hosting_location: null };
    const { subject, body } = breachNoticeTemplate({ description: "A laptop was stolen.", dataCategories: ["names", "emails"], actions: null, awareAt }, company);
    expect(subject).toMatch(/security incident/);
    expect(body).toContain("A laptop was stolen.");
    expect(body).toContain("names, emails");
    expect(body).toContain("[describe the steps taken");
    expect(body).toContain("dpo@townmart.ng");
  });
});

describe("data request deadlines", () => {
  it("counts whole days left, and days overdue", () => {
    expect(deadline(null, now)).toBeNull();
    expect(deadline(new Date(now.getTime() + 10 * DAY), now)).toEqual({ daysLeft: 10, overdue: false, label: "10 days left" });
    expect(deadline(new Date(now.getTime() + 2 * HOUR), now)?.label).toBe("Due within a day");
    expect(deadline(new Date(now.getTime() - 1 * HOUR), now)).toMatchObject({ overdue: true, label: "1 day overdue" });
    expect(deadline(new Date(now.getTime() - 3 * DAY), now)?.label).toBe("3 days overdue");
  });
});

describe("signed links and cookies", () => {
  it("accepts a pending two-step sign-in only untampered and in time", () => {
    const userId = randomUUID();
    const exp = now.getTime() + 10 * 60_000;
    const value = encodePending({ userId, next: "/account/orders", exp });
    expect(decodePending(value, now.getTime())).toEqual({ userId, next: "/account/orders", exp });
    expect(decodePending(value, exp + 1)).toBeNull();
    expect(decodePending(value.replace(userId, randomUUID()), now.getTime())).toBeNull();
    expect(decodePending(encodePending({ userId, next: null, exp }), now.getTime())?.next).toBeNull();
    expect(decodePending("a.b.c", now.getTime())).toBeNull();
  });

  it("unsubscribes the address the link was made for, and nothing else", () => {
    const url = new URL(unsubscribeUrl("Ada@Example.com"));
    const e = url.searchParams.get("e");
    const t = url.searchParams.get("t");
    expect(verifyUnsubscribe(e, t)).toBe("ada@example.com");
    expect(verifyUnsubscribe(Buffer.from("someone@else.com").toString("base64url"), t)).toBeNull();
    expect(verifyUnsubscribe(e, null)).toBeNull();
    expect(new URL(unsubscribeUrl("ada@example.com", "one-click")).pathname).toBe("/api/unsubscribe");
  });

  it("opens an export only with its own signature, file and expiry", () => {
    const id = randomUUID();
    const url = new URL(exportDownloadUrl(id, "pdf", new Date(now.getTime() + 7 * DAY)));
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    expect(verifyExportLink(id, "pdf", exp, sig, now)).toBe(true);
    expect(verifyExportLink(id, "json", exp, sig, now)).toBe(false);
    expect(verifyExportLink(randomUUID(), "pdf", exp, sig, now)).toBe(false);
    expect(verifyExportLink(id, "pdf", String(Number(exp) + 86_400), sig, now)).toBe(false);
    expect(verifyExportLink(id, "pdf", exp, sig, new Date(now.getTime() + 8 * DAY))).toBe(false);
  });
});

describe("export PDF", () => {
  it("builds a readable PDF, even with characters outside Latin-1", async () => {
    const at = now.toISOString();
    const order = {
      orderNumber: "TM-2026-000001",
      placedAt: at,
      total: "12,500.00",
      paymentStatus: "paid",
      sellers: [{ seller: "Ikeja Fresh Mart", status: "delivered", items: [{ title: "Ọfada rice “premium” — 5kg", qty: "2" }] }],
      refunds: [{ number: "RF-2026-000001", amount: "2,000.00", status: "completed" }],
    };
    const data = {
      generatedAt: at,
      profile: { name: "Adaọra Ọkafor", email: "ada@example.com", phone: "+2348031234567", status: "active", signInWith: ["password"], twoStepSignIn: true, createdAt: at, lastLoginAt: null },
      addresses: [{ label: "Home", recipientName: "Ada", line1: "12 Allen Avenue", line2: null, city: "Ikeja", lga: "Ikeja", state: "Lagos", phone: null }],
      // Enough orders to need more than one page.
      orders: Array.from({ length: 40 }, () => order),
      bookings: [{ service: "Plumbing", provider: "Fix It", startsAt: at, status: "completed" }],
      reviews: [{ seller: "Ikeja Fresh Mart", rating: 5, review: "Fresh, as promised ₦" }],
      notificationSettings: { smsOrderUpdates: true, smsBookingReminders: true, marketingEmail: false },
      cookieChoices: [{ at, functional: true, analytics: false, marketing: false }],
      agreements: [{ document: "Terms of Use", version: "2026-10-draft", at }],
      dataRequests: [{ reference: "DSR-2026-000001", type: "access", status: "open" }],
    } as unknown as PersonalDataExport;
    const bytes = await buildExportPdf(data);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getTitle()).toBe("Your TownMart data");
  });
});
