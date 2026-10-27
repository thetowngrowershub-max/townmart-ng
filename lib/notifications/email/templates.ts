import type { EmailMessage } from "./provider";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, bodyHtml: string, footer = "You received this email because of activity on your TownMart account. If this wasn't you, you can ignore it."): string {
  return `<!doctype html><html lang="en"><body style="margin:0;background:#FAFAF7;font-family:Inter,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td><p style="margin:0 0 24px;font-weight:700;font-size:20px;color:#0F6B3E">TownMart</p>
<h1 style="margin:0 0 16px;font-size:22px">${escape(title)}</h1>${bodyHtml}
<p style="margin:32px 0 0;font-size:12px;color:#64748b">${footer}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escape(href)}" style="display:inline-block;background:#0F6B3E;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">${escape(label)}</a></p>
<p style="font-size:13px;color:#475569">Or paste this link into your browser:<br>${escape(href)}</p>`;
}

export function verifyEmailTemplate(params: { to: string; name: string | null; url: string }): EmailMessage {
  const greeting = params.name ? `Hi ${params.name},` : "Hi,";
  return {
    to: params.to,
    subject: "Confirm your email address",
    html: layout(
      "Confirm your email",
      `<p>${escape(greeting)}</p><p>Please confirm your email address to finish setting up your TownMart account. This link expires in 24 hours.</p>${button(params.url, "Confirm email")}`,
    ),
    text: `${greeting}\n\nConfirm your TownMart email address (link expires in 24 hours):\n${params.url}\n`,
  };
}

export function resetPasswordTemplate(params: { to: string; url: string }): EmailMessage {
  return {
    to: params.to,
    subject: "Reset your TownMart password",
    html: layout(
      "Reset your password",
      `<p>We received a request to reset your password. This link expires in 1 hour and can be used once.</p>${button(params.url, "Choose a new password")}`,
    ),
    text: `Reset your TownMart password (link expires in 1 hour):\n${params.url}\n`,
  };
}

export function sellerSubmittedTemplate(params: { to: string; businessName: string; url: string }): EmailMessage {
  return {
    to: params.to,
    subject: "We've received your seller application",
    html: layout(
      "Application received",
      `<p>Thanks for applying to sell on TownMart as <strong>${escape(params.businessName)}</strong>.</p><p>Our team checks every application, usually within 2 working days. We'll email you as soon as there's a decision. You can add listings while you wait; they go live once you're approved.</p>${button(params.url, "Open your dashboard")}`,
    ),
    text: `Thanks for applying to sell on TownMart as ${params.businessName}. We usually review applications within 2 working days.\n${params.url}\n`,
  };
}

export function sellerDecisionTemplate(params: {
  to: string;
  businessName: string;
  decision: "approved" | "rejected" | "suspended";
  reason?: string;
  url: string;
}): EmailMessage {
  const copy = {
    approved: {
      subject: "Your TownMart store is approved",
      title: "You're approved",
      body: `<p><strong>${escape(params.businessName)}</strong> is now live on TownMart. Active listings are visible to shoppers straight away.</p>`,
      cta: "Go to your dashboard",
    },
    rejected: {
      subject: "Your seller application needs changes",
      title: "Changes needed",
      body: `<p>We couldn't approve <strong>${escape(params.businessName)}</strong> yet. Here's what to fix:</p><blockquote style="margin:16px 0;padding:12px 16px;background:#f1f5f9;border-radius:12px">${escape(params.reason ?? "")}</blockquote><p>Update your application and submit it again.</p>`,
      cta: "Update application",
    },
    suspended: {
      subject: "Your TownMart store has been suspended",
      title: "Store suspended",
      body: `<p><strong>${escape(params.businessName)}</strong> has been suspended and its listings are hidden.</p><blockquote style="margin:16px 0;padding:12px 16px;background:#f1f5f9;border-radius:12px">${escape(params.reason ?? "")}</blockquote><p>Reply to this email if you think this is a mistake.</p>`,
      cta: "Open your dashboard",
    },
  }[params.decision];
  return {
    to: params.to,
    subject: copy.subject,
    html: layout(copy.title, `${copy.body}${button(params.url, copy.cta)}`),
    text: `${copy.subject}${params.reason ? `\n\n${params.reason}` : ""}\n\n${params.url}\n`,
  };
}

export function lowStockTemplate(params: {
  to: string;
  businessName: string;
  items: { title: string; sku: string; stock: string; threshold: string }[];
  url: string;
}): EmailMessage {
  const rows = params.items
    .map((i) => `<li><strong>${escape(i.title)}</strong> (${escape(i.sku)}): ${escape(i.stock)} left, alert at ${escape(i.threshold)}</li>`)
    .join("");
  return {
    to: params.to,
    subject: `Low stock: ${params.items.length} item${params.items.length === 1 ? "" : "s"} at ${params.businessName}`,
    html: layout("Running low on stock", `<p>These items reached their low-stock threshold:</p><ul>${rows}</ul>${button(params.url, "Review inventory")}`),
    text: `These items reached their low-stock threshold:\n${params.items.map((i) => `- ${i.title} (${i.sku}): ${i.stock} left`).join("\n")}\n\n${params.url}\n`,
  };
}

export function importFinishedTemplate(params: { to: string; fileName: string; succeeded: number; failed: number; url: string }): EmailMessage {
  const summary = `${params.succeeded} row${params.succeeded === 1 ? "" : "s"} imported, ${params.failed} with errors.`;
  return {
    to: params.to,
    subject: `Import finished: ${params.fileName}`,
    html: layout("Your product import has finished", `<p>${escape(params.fileName)}: ${escape(summary)}</p>${button(params.url, "View the report")}`),
    text: `${params.fileName}: ${summary}\n${params.url}\n`,
  };
}

export type ReceiptSeller = {
  name: string;
  city: string;
  method: "delivery" | "pickup" | "none";
  eta: string | null;
  returnWindowDays: number;
  /** `when` is set on bookings: the appointment time and place. */
  items: { title: string; options: string; qty: string; total: string; discount: string | null; when?: string | null }[];
  subtotal: string;
  delivery: string;
};

/** Itemised receipt: every seller's name and location, all fees, and the refund policy. */
export function orderReceiptTemplate(params: {
  to: string;
  name: string;
  orderNumber: string;
  placedAt: string;
  payOnDelivery: boolean;
  sellers: ReceiptSeller[];
  totals: { subtotal: string; discount: string | null; delivery: string; serviceFee: string; vat: string; payLater?: string | null; total: string };
  address: string;
  orderUrl: string;
  refundPolicyUrl: string;
}): EmailMessage {
  const cell = "padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:14px";
  const sellerBlocks = params.sellers
    .map(
      (s) => `<h2 style="font-size:16px;margin:24px 0 4px">${escape(s.name)}</h2>
<p style="margin:0 0 8px;font-size:13px;color:#475569">${escape(s.city)} · ${s.method === "none" ? "Bookings" : `${s.method === "pickup" ? "Pickup from the seller" : `Delivery${s.eta ? `, ${escape(s.eta)}` : ""}`} · Returns within ${s.returnWindowDays} days`}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${s.items
        .map(
          (i) =>
            `<tr><td style="${cell}">${escape(i.title)}${i.options ? ` <span style="color:#64748b">(${escape(i.options)})</span>` : ""}${i.when ? `<br><span style="font-size:13px">${escape(i.when)}</span>` : ` × ${escape(i.qty)}`}${i.discount ? `<br><span style="color:#0F6B3E;font-size:12px">You saved ${escape(i.discount)}</span>` : ""}</td><td align="right" style="${cell}">${escape(i.total)}</td></tr>`,
        )
        .join("")}${s.method === "none" ? "" : `<tr><td style="${cell}">Delivery</td><td align="right" style="${cell}">${escape(s.delivery)}</td></tr>`}</table>`,
    )
    .join("");
  const t = params.totals;
  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:4px 0;font-size:14px${strong ? ";font-weight:700" : ""}">${escape(label)}</td><td align="right" style="padding:4px 0;font-size:14px${strong ? ";font-weight:700" : ""}">${escape(value)}</td></tr>`;
  const totals = `<table role="presentation" width="100%" style="margin-top:16px">${row("Items", t.subtotal)}${t.discount ? row("Discounts", `−${t.discount}`) : ""}${row("Delivery", t.delivery)}${row("Service fee", t.serviceFee)}${row("VAT on service fee", t.vat)}${t.payLater ? row("Booking balance, paid to the provider on the day", `−${t.payLater}`) : ""}${row(params.payOnDelivery ? "To pay on delivery" : "Total paid", t.total, true)}</table>`;
  const intro = params.payOnDelivery
    ? `Thanks for your order, ${escape(params.name)}. You'll pay ${escape(t.total)} when it arrives.`
    : `Thanks for your order, ${escape(params.name)}. We've received your payment of ${escape(t.total)}.`;
  return {
    to: params.to,
    subject: `Your TownMart order ${params.orderNumber}`,
    html: layout(
      `Order ${params.orderNumber}`,
      `<p>${intro}</p><p style="font-size:13px;color:#475569">Placed ${escape(params.placedAt)}. Delivering to: ${escape(params.address)}</p>${sellerBlocks}${totals}${button(params.orderUrl, "View your order")}<p style="font-size:13px;color:#475569">Something wrong? See our <a href="${escape(params.refundPolicyUrl)}">Refund &amp; Returns policy</a>. Sellers are paid only after your order is delivered.</p>`,
    ),
    text: `Order ${params.orderNumber}\n\n${params.payOnDelivery ? "Pay on delivery" : "Paid"}: ${t.total}\n\n${params.sellers
      .map((s) => `${s.name} (${s.city})\n${s.items.map((i) => `- ${i.title}${i.options ? ` (${i.options})` : ""} x ${i.qty}: ${i.total}`).join("\n")}\nDelivery: ${s.delivery}`)
      .join("\n\n")}\n\nItems ${t.subtotal}${t.discount ? `, discounts -${t.discount}` : ""}, delivery ${t.delivery}, service fee ${t.serviceFee}, VAT ${t.vat}. Total ${t.total}.\n\nView your order: ${params.orderUrl}\nRefund policy: ${params.refundPolicyUrl}\n`,
  };
}

export function sellerNewOrderTemplate(params: {
  to: string;
  businessName: string;
  orderNumber: string;
  payOnDelivery: boolean;
  method: "delivery" | "pickup" | "none";
  items: { title: string; options: string; qty: string; when?: string | null }[];
  net: string;
  url: string;
}): EmailMessage {
  const list = params.items.map((i) => `<li>${escape(i.title)}${i.options ? ` (${escape(i.options)})` : ""}${i.when ? `: ${escape(i.when)}` : ` × ${escape(i.qty)}`}</li>`).join("");
  const kind = params.method === "none" ? "booking" : params.method === "pickup" ? "pickup" : "delivery";
  return {
    to: params.to,
    subject: `New order ${params.orderNumber}`,
    html: layout(
      `New order for ${params.businessName}`,
      `<p>You have a new ${kind} order${params.payOnDelivery ? " (pay on delivery: collect payment on handover)" : ", already paid"}.</p><ul>${list}</ul><p>Your earnings after commission: <strong>${escape(params.net)}</strong>, paid out after it's delivered or done.</p>${button(params.url, "Open the order")}`,
    ),
    text: `New order ${params.orderNumber} for ${params.businessName}:\n${params.items.map((i) => `- ${i.title}${i.when ? `: ${i.when}` : ` x ${i.qty}`}`).join("\n")}\nEarnings after commission: ${params.net}\n${params.url}\n`,
  };
}

/**
 * A short update about an order, booking or message: a title, a few lines
 * of plain text and one button. Used for status changes and reminders.
 */
export function noticeTemplate(params: { to: string; subject: string; title: string; lines: string[]; url: string; buttonLabel: string }): EmailMessage {
  return {
    to: params.to,
    subject: params.subject,
    html: layout(params.title, `${params.lines.map((l) => `<p>${escape(l)}</p>`).join("")}${button(params.url, params.buttonLabel)}`),
    text: `${params.title}\n\n${params.lines.join("\n\n")}\n\n${params.buttonLabel}: ${params.url}\n`,
  };
}

/**
 * Marketing email: only for people who opted in (lib/marketing.ts), with a
 * one-click unsubscribe link in the footer and in the List-Unsubscribe headers.
 */
export function marketingTemplate(params: { to: string; subject: string; title: string; lines: string[]; url: string; buttonLabel: string; unsubscribeUrl: string; oneClickUrl: string }): EmailMessage {
  const footer = `You're getting this because you asked for offers from TownMart. <a href="${escape(params.unsubscribeUrl)}" style="color:#64748b">Unsubscribe</a> with one click.`;
  return {
    to: params.to,
    subject: params.subject,
    html: layout(params.title, `${params.lines.map((l) => `<p>${escape(l)}</p>`).join("")}${button(params.url, params.buttonLabel)}`, footer),
    text: `${params.title}\n\n${params.lines.join("\n\n")}\n\n${params.buttonLabel}: ${params.url}\n\nUnsubscribe: ${params.unsubscribeUrl}\n`,
    headers: { "List-Unsubscribe": `<${params.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
