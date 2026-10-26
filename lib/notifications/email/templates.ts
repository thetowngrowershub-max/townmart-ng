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
