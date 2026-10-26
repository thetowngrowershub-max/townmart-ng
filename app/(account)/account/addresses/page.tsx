import type { Metadata } from "next";
import { AddressBook } from "@/components/account/address-book";
import { PageHeader } from "@/components/layout/app-shell";
import { requirePermission } from "@/lib/auth/current-user";
import { decrypt } from "@/lib/crypto";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Addresses" };

export default async function AddressesPage() {
  const user = await requirePermission("account.access", "/account/addresses");
  const [addresses, states] = await withRls({ userId: user.id }, (tx) =>
    Promise.all([
      tx.address.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }], include: { state: true, lga: true } }),
      tx.state.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, lgas: { orderBy: { name: "asc" }, select: { id: true, name: true } } } }),
    ]),
  );
  const rows = addresses.map((a) => ({
    id: a.id,
    recipientName: a.recipientName,
    isDefault: a.isDefault,
    lines: [
      [decrypt(a.line1Encrypted), a.line2Encrypted ? decrypt(a.line2Encrypted) : null].filter(Boolean).join(", "),
      a.landmark ? `Near ${a.landmark}` : null,
      `${a.city}, ${a.lga.name}, ${a.state.name}`,
      decrypt(a.phoneEncrypted),
    ].filter((x): x is string => Boolean(x)),
  }));
  return (
    <>
      <PageHeader title="Addresses" description="Where we deliver your orders. Street addresses and phone numbers are stored encrypted." />
      <AddressBook addresses={rows} states={states} />
    </>
  );
}
