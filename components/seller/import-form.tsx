"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PrivateFileInput, type PrivateFile } from "@/components/uploads/private-file-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { startProductImportAction } from "@/lib/catalogue/import-actions";

export function ImportForm() {
  const router = useRouter();
  const [files, setFiles] = useState<PrivateFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert variant="danger">{error}</Alert>}
      <PrivateFileInput kind="csv" label="CSV file (max 5 MB, 5,000 rows)" accept=".csv,text/csv" max={1} value={files} onChange={setFiles} />
      <Button
        className="self-start"
        disabled={!files[0] || pending}
        onClick={() =>
          start(async () => {
            const f = files[0]!;
            const res = await startProductImportAction({ tmpKey: f.tmpKey, fileName: f.name });
            if (res.ok) router.push(`/dashboard/products/import/${res.data!.id}`);
            else setError(res.error);
          })
        }
      >
        {pending ? "Starting…" : "Start import"}
      </Button>
    </div>
  );
}
