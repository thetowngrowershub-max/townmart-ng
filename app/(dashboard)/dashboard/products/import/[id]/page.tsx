import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { IMPORT_STATUS } from "@/components/seller/import-status";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ImportReport } from "@/lib/catalogue/csv";
import { formatDateTime } from "@/lib/datetime";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Import report" };

export default async function ImportReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSellerPage(`/dashboard/products/import/${id}`, "import.manage");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const job = await withSellerRls(ctx, (tx) => tx.importJob.findFirst({ where: { id, businessId: ctx.business.id } }));
  if (!job) notFound();
  const report = (job.report ?? { errors: [], warnings: [] }) as ImportReport;
  const running = job.status === "queued" || job.status === "processing";
  const s = IMPORT_STATUS[job.status];

  return (
    <>
      {running && <AutoRefresh seconds={3} />}
      <PageHeader
        title={job.fileName}
        description={`Uploaded ${formatDateTime(job.createdAt)}`}
        actions={
          <Link href="/dashboard/products/import" className="text-sm text-primary underline">
            All imports
          </Link>
        }
      />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center gap-3">
            <CardTitle className="mr-auto">Summary</CardTitle>
            <Badge variant={s.variant}>{s.label}</Badge>
          </CardHeader>
          <CardContent className="text-sm">
            {running ? (
              <p role="status">Processing… this page updates by itself. We&apos;ll also email you when it&apos;s done.</p>
            ) : (
              <p>
                {job.totalRows} rows: <strong>{job.succeededRows}</strong> imported, <strong>{job.failedRows}</strong> with errors.
              </p>
            )}
          </CardContent>
        </Card>
        {report.errors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Rows to fix</CardTitle>
            </CardHeader>
            <CardContent>
              <Alert variant="warning" className="mb-4">
                Fix these rows in your file and import it again. Rows that imported fine are matched by SKU, so they won&apos;t be duplicated.
              </Alert>
              <ul className="flex flex-col gap-3 text-sm">
                {report.errors.map((e) => (
                  <li key={`${e.row}-${e.handle}`} className="rounded-xl border p-3">
                    <p className="font-semibold">
                      {e.row > 0 ? `Line ${e.row}` : "File"}
                      {e.handle && !e.handle.startsWith("__") && <span className="font-normal text-muted-foreground"> · handle {e.handle}</span>}
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-danger">
                      {e.messages.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        {report.warnings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                {report.warnings.map((w) => (
                  <li key={`${w.row}-${w.handle}`}>
                    <strong>Line {w.row}</strong> ({w.handle}): {w.messages.join(" ")}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
