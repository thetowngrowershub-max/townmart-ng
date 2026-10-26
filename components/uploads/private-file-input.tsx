"use client";

import { FileCheck2, Loader2, Upload, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { uploadPrivateFile } from "./upload-client";

export type PrivateFile = { tmpKey: string; name: string };

/** Uploads files to the private bucket and reports their temporary keys. */
export function PrivateFileInput({
  kind,
  accept,
  max,
  value,
  onChange,
  error,
  label,
}: {
  kind: "kyc" | "csv";
  accept: string;
  max: number;
  value: PrivateFile[];
  onChange: (next: PrivateFile[]) => void;
  error?: string;
  label: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {value.length > 0 && (
        <ul className="flex flex-col gap-2">
          {value.map((f) => (
            <li key={f.tmpKey} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
              <FileCheck2 className="size-4 text-success" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((v) => v.tmpKey !== f.tmpKey))} aria-label={`Remove ${f.name}`}>
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {value.length < max && (
        <div>
          <span className="relative inline-flex h-11 items-center gap-2 rounded-xl border border-input bg-card px-4 text-sm font-semibold focus-within:outline-2 focus-within:outline-ring hover:bg-muted">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {busy ? "Uploading…" : "Choose file"}
            <input
              id={id}
              type="file"
              accept={accept}
              disabled={busy}
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setUploadError(null);
                try {
                  const tmpKey = await uploadPrivateFile(file, kind);
                  onChange([...value, { tmpKey, name: file.name }]);
                } catch (err) {
                  setUploadError(err instanceof Error ? err.message : "Upload failed.");
                } finally {
                  setBusy(false);
                }
              }}
            />
          </span>
        </div>
      )}
      {(uploadError || error) && <p className="text-xs font-medium text-danger">{uploadError ?? error}</p>}
    </div>
  );
}
