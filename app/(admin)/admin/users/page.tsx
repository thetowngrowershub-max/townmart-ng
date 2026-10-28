import type { Prisma, Role, UserStatus } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Pagination } from "@/components/storefront/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/datetime";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Users and roles" };

const PAGE_SIZE = 25;
const ROLES: Role[] = ["customer", "merchant", "service_provider", "staff", "admin", "super_admin"];
const STATUSES: UserStatus[] = ["active", "suspended", "pending_deletion", "anonymised"];
const roleLabel = (r: string) => r.replace("_", " ");

type SP = { q?: string; role?: string; status?: string; page?: string };

export default async function UsersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("user.manage", "/admin/users");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const role = ROLES.find((r) => r === sp.role);
  const status = STATUSES.find((s) => s === sp.status);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const where: Prisma.UserWhereInput = {
    ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}),
    ...(role ? { roles: { some: { role } } } : {}),
    ...(status ? { status } : {}),
  };
  const { rows, total } = await withRls({ scope: "admin", userId: user.id }, async (tx) => ({
    rows: await tx.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, email: true, name: true, status: true, createdAt: true, lastLoginAt: true, roles: { select: { role: true } } },
    }),
    total: await tx.user.count({ where }),
  }));
  const qs = (n: number) => new URLSearchParams({ ...(q ? { q } : {}), ...(role ? { role } : {}), ...(status ? { status } : {}), page: String(n) }).toString();

  return (
    <>
      <PageHeader title="Users and roles" description={`${total.toLocaleString("en-NG")} account${total === 1 ? "" : "s"}${q || role || status ? " match" : ""}.`} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="sr-only">
            Search by email or name
          </label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Search by email or name" />
        </div>
        <div className="w-44">
          <label htmlFor="role" className="sr-only">
            Role
          </label>
          <Select id="role" name="role" defaultValue={role ?? ""}>
            <option value="">Any role</option>
            {ROLES.map((r) => (
              <option key={r} value={r} className="capitalize">
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <label htmlFor="status" className="sr-only">
            Status
          </label>
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {roleLabel(s)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Account</th>
              <th scope="col" className="px-4 py-3 font-medium">Roles</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Joined</th>
              <th scope="col" className="px-4 py-3 font-medium">Last sign-in</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No accounts match.
                </td>
              </tr>
            )}
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-muted/40">
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                    {u.name ?? u.email}
                  </Link>
                  {u.name && <span className="block text-xs text-muted-foreground">{u.email}</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r.role} variant={r.role === "admin" || r.role === "super_admin" ? "default" : "secondary"} className="capitalize">
                        {roleLabel(r.role)}
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className="px-4 py-3 capitalize">{u.status === "active" ? "Active" : <Badge variant={u.status === "suspended" ? "danger" : "secondary"}>{roleLabel(u.status)}</Badge>}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(u.createdAt)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{u.lastLoginAt ? formatDate(u.lastLoginAt) : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} href={(n) => `/admin/users?${qs(n)}`} />
    </>
  );
}
