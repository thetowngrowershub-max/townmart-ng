import { withSystemContext } from "@/lib/db";
import { formatDateTime } from "@/lib/datetime";
import { env } from "@/lib/env";
import { customerSelect, sellerSelect, tellCustomer, tellSeller, type Customer } from "@/lib/fulfilment/notify";
import { formatPrice } from "@/lib/money";
import { orderAccessToken } from "@/lib/orders/place";
import type { FulfilmentNotice } from "@/lib/queue";
import { OUTCOME_LABELS } from "@/lib/disputes/core";
import { REASON_LABELS } from "./math";

/** The customer's help page for one seller's part of their order (guests get their order link's token). */
export function helpPath(o: { id: string; orderNumber: string; isGuest: boolean }, sellerOrderId: string): string {
  return `/orders/${o.orderNumber}/help/${sellerOrderId}${o.isGuest ? `?t=${encodeURIComponent(orderAccessToken(o.id))}` : ""}`;
}

const helpLink = (o: Customer, sellerOrderId: string | null) => {
  if (!sellerOrderId) return undefined;
  const path = helpPath(o, sellerOrderId);
  return { url: `${env().APP_URL}${path}`, path };
};

type MoneyNotice = Extract<FulfilmentNotice, { type: "refund.update" | "dispute.update" | "payout.update" }>;

/**
 * Worker handler for refund, dispute and payout notices. Each is sent only if
 * the thing is still in the state the notice is about (a retried job after a
 * later change says nothing stale).
 */
export async function sendMoneyNotice(n: MoneyNotice): Promise<void> {
  await withSystemContext(async (tx) => {
    if (n.type === "refund.update") {
      const r = await tx.refund.findUnique({ where: { id: n.refundId }, include: { order: { select: customerSelect }, business: { select: sellerSelect } } });
      if (!r || r.status !== n.status) return;
      const total = formatPrice(r.amountKobo + r.feeKobo + r.vatKobo);
      const shop = r.business?.name ?? "TownMart";
      const link = helpLink(r.order, r.sellerOrderId);
      switch (r.status) {
        case "requested":
          if (r.origin !== "customer" || !r.business || !r.sellerOrderId) return;
          await tellSeller(tx, r.business, {
            type: "refund.requested",
            title: `Refund request ${r.refundNumber} for ${r.order.orderNumber}`,
            lines: [`${r.order.customerName} asked for ${formatPrice(r.requestedKobo)} back: ${REASON_LABELS[r.reason]}.`, r.respondBy ? `Please answer by ${formatDateTime(r.respondBy)}, or TownMart will decide.` : "Please answer soon."],
            path: `/dashboard/refunds/${r.id}`,
          });
          return;
        case "approved":
          await tellCustomer(tx, r.order, {
            type: "refund.approved",
            title: `Refund approved: ${total}`,
            lines: [
              r.reason === "payment_problem"
                ? `We couldn't use a payment you made for ${r.order.orderNumber} (${r.details ?? "payment problem"}), so we're refunding ${total} to your original payment method.`
                : `${shop} approved a refund of ${total} (${r.refundNumber}). We're sending it to your original payment method; banks can take a few working days to show it.`,
            ],
            sms: `TownMart: refund of ${total} for ${r.order.orderNumber} approved. It goes back to your original payment method.`,
            link,
            buttonLabel: link ? "See the refund" : undefined,
          });
          return;
        case "completed":
          await tellCustomer(tx, r.order, {
            type: "refund.completed",
            title: `Refunded: ${total}`,
            lines: [`Your refund of ${total} (${r.refundNumber}) has been paid back by our payment provider. If you can't see it after 5 working days, reply to this email with the refund number.`],
            sms: null,
            link,
            buttonLabel: link ? "See the refund" : undefined,
          });
          return;
        case "rejected":
          await tellCustomer(tx, r.order, {
            type: "refund.rejected",
            title: `${shop} declined your refund request`,
            lines: [`Their reason: “${r.response ?? "No reason given"}”.`, "If you disagree, you can ask TownMart to decide from your order's help page."],
            sms: null,
            link,
            buttonLabel: "Ask TownMart to decide",
          });
          return;
        default:
          return;
      }
    }

    if (n.type === "dispute.update") {
      const d = await tx.dispute.findUnique({
        where: { id: n.disputeId },
        include: { sellerOrder: { select: { id: true, orderNumber: true, order: { select: customerSelect } } }, business: { select: sellerSelect } },
      });
      if (!d) return;
      const order = d.sellerOrder.order;
      const link = helpLink(order, d.sellerOrderId);
      const sellerPath = `/dashboard/disputes/${d.id}`;
      if (n.event === "opened") {
        await tellSeller(tx, d.business, {
          type: "dispute.opened",
          title: `TownMart is looking into ${d.sellerOrder.orderNumber}`,
          lines: [d.openedByParty === "system" ? "A refund request wasn't answered in time, so TownMart will decide it." : `${order.customerName} asked TownMart to step in.`, "Add anything we should know (photos, delivery proof) to the dispute. Payouts for this order are on hold until it's decided."],
          path: sellerPath,
        });
        if (d.openedByParty === "system") {
          await tellCustomer(tx, order, { type: "dispute.opened", title: "TownMart will decide your refund request", lines: [`${d.business.name} didn't answer in time, so our team will look at it and decide.`], sms: null, link, buttonLabel: "See the dispute" });
        }
        return;
      }
      if (n.event === "message" && n.messageId) {
        const m = await tx.disputeMessage.findUnique({ where: { id: n.messageId } });
        if (!m) return;
        const preview = m.body.length > 140 ? `${m.body.slice(0, 140)}…` : m.body;
        if (m.sender !== "seller") await tellSeller(tx, d.business, { type: "dispute.message", title: `New message on the dispute about ${d.sellerOrder.orderNumber}`, lines: [`“${preview}”`], path: sellerPath });
        if (m.sender !== "customer") await tellCustomer(tx, order, { type: "dispute.message", title: `New message about ${order.orderNumber}`, lines: [`“${preview}”`], sms: null, link, buttonLabel: "See the dispute" });
        return;
      }
      if (n.event === "resolved" && d.status === "resolved" && d.outcome) {
        const lines = [`TownMart's decision: ${OUTCOME_LABELS[d.outcome]}.`, ...(d.resolutionNote ? [d.resolutionNote] : [])];
        await tellCustomer(tx, order, { type: "dispute.resolved", title: `Decision on ${order.orderNumber}`, lines, sms: `TownMart has decided your dispute about ${order.orderNumber}: ${OUTCOME_LABELS[d.outcome]}.`, link, buttonLabel: "See the decision" });
        await tellSeller(tx, d.business, { type: "dispute.resolved", title: `Decision on ${d.sellerOrder.orderNumber}`, lines, path: sellerPath });
      }
      return;
    }

    const p = await tx.payout.findUnique({ where: { id: n.payoutId }, include: { business: { select: sellerSelect } } });
    if (!p || p.status !== n.status) return;
    if (p.status === "paid") {
      await tellSeller(tx, p.business, { type: "payout.paid", title: `Payout sent: ${formatPrice(p.amountKobo)}`, lines: [`We've sent ${formatPrice(p.amountKobo)} to ${p.bankName} ••••${p.accountNumberLast4}.`], path: "/dashboard/payouts" });
    } else if (p.status === "failed") {
      await tellSeller(tx, p.business, {
        type: "payout.failed",
        title: "A payout didn't go through",
        lines: [`${formatPrice(p.amountKobo)} to ${p.bankName} ••••${p.accountNumberLast4} failed and is back in your balance.`, "Check your bank details in Store settings. We'll try again with the next payout."],
        path: "/dashboard/payouts",
      });
    }
  });
}
