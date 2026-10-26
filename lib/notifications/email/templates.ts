import type { EmailMessage } from "./provider";

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><body style="margin:0;background:#FAFAF7;font-family:Inter,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td><p style="margin:0 0 24px;font-weight:700;font-size:20px;color:#0F6B3E">TownMart</p>
<h1 style="margin:0 0 16px;font-size:22px">${escape(title)}</h1>${bodyHtml}
<p style="margin:32px 0 0;font-size:12px;color:#64748b">You received this email because of activity on your TownMart account. If this wasn't you, you can ignore it.</p>
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
