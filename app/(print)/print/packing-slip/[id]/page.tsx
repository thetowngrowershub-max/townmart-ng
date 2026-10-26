import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/orders/print-button";
import { loadSellerOrder } from "@/lib/fulfilment/seller-view";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Packing slip", robots: { index: false } };

/**
 * A printable packing slip for the seller's part of an order: what to pack
 * and where it goes. No prices, so it can travel in the parcel. Use the
 * browser's print dialog to print or save as PDF.
 */
export default async function PackingSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSellerPage(`/print/packing-slip/${id}`, "order.read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const order = await withSellerRls(ctx, (tx) => loadSellerOrder(tx, ctx.business.id, id));
  if (!order || order.method === "none") notFound();
  const goods = order.items.filter((i) => !i.booking);

  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-black print:p-0">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-[#0F6B3E]">TownMart</p>
          <h1 className="text-2xl font-bold">Packing slip</h1>
          <p className="text-sm">
            Order <span className="font-mono font-semibold">{order.orderNumber}</span> · {order.placedAt}
          </p>
        </div>
        <PrintButton />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-6 text-sm">
        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">From</h2>
          <p className="font-semibold">{ctx.business.name}</p>
        </section>
        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{order.method === "pickup" ? "Collected by" : "Deliver to"}</h2>
          <p className="font-semibold">{order.customer.name}</p>
          {order.customer.phone && <p>{order.customer.phone}</p>}
          {order.method === "delivery" && order.customer.address?.map((l) => <p key={l}>{l}</p>)}
        </section>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th scope="col" className="py-2 pr-2">Item</th>
            <th scope="col" className="py-2 pr-2">SKU</th>
            <th scope="col" className="py-2 text-right">Quantity</th>
            <th scope="col" className="w-16 py-2 text-center">Packed</th>
          </tr>
        </thead>
        <tbody>
          {goods.map((i) => (
            <tr key={i.id} className="border-b border-neutral-300">
              <td className="py-2 pr-2">
                {i.title}
                {i.options && <span className="text-neutral-600"> ({i.options})</span>}
              </td>
              <td className="py-2 pr-2 font-mono text-xs">{i.sku}</td>
              <td className="py-2 text-right tabular-nums">
                {i.qty} {i.unit}
              </td>
              <td className="py-2 text-center">☐</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-6 text-sm">{order.payOnDelivery ? "Pay on delivery: collect payment on handover." : "Paid online. Nothing to collect."}</p>
      <p className="mt-8 text-xs text-neutral-500">Questions about this order? Message the customer from your TownMart dashboard. Returns follow the store&apos;s return policy and TownMart&apos;s Refund &amp; Returns Policy.</p>
    </main>
  );
}
