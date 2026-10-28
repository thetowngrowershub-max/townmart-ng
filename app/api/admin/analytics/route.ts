import { dashboard, parseRange } from "@/lib/analytics/metrics";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";
import { csvRows } from "@/lib/csv";
import { withRls } from "@/lib/db";
import { koboToNairaString } from "@/lib/money";

/** The analytics page's daily figures as CSV (Lagos days, amounts in naira). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!can(user, "analytics.view")) return new Response("Not allowed", { status: user ? 403 : 401 });
  const days = parseRange(new URL(req.url).searchParams.get("days") ?? undefined);
  const d = await withRls({ scope: "admin", userId: user!.id }, (tx) => dashboard(tx, days));
  const body = csvRows([["Day", "Confirmed orders", "GMV (NGN)"], ...d.series.map((p) => [p.day, String(p.orders), koboToNairaString(p.gmvKobo)])]);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="townmart-daily-${days}d.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
