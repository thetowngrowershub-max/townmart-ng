"use client";

import { Loader2, Upload, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ImagePurpose } from "@/lib/storage/uploads";
import { cn } from "@/lib/utils";
import { uploadImage, type UploadedImage } from "./upload-client";

/** One image (store logo or banner) with a preview. */
export function SingleImageInput({
  label,
  hint,
  purpose,
  value,
  onChange,
  upload,
}: {
  label: string;
  hint?: string;
  purpose: Extract<ImagePurpose, "logo" | "banner">;
  /** Replaces the seller upload, e.g. for TownMart's own banners. */
  upload?: (file: File) => Promise<UploadedImage>;
  value: { key: string; url: string } | null;
  onChange: (next: { key: string; url: string } | null) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium" id={`${id}-label`}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={cn(
            "flex items-center justify-center overflow-hidden rounded-xl border bg-muted",
            purpose === "logo" ? "size-20" : "h-20 w-60",
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- preview of the uploaded image
            <img src={value.url} alt={`${label} preview`} className="size-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground">None</span>
          )}
        </div>
        <label htmlFor={id} className="cursor-pointer">
          <span className="inline-flex h-9 items-center gap-2 rounded-xl border border-input bg-card px-3 text-sm font-semibold hover:bg-muted">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {value ? "Replace" : "Upload"}
          </span>
          <input
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-labelledby={`${id}-label`}
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setError(null);
              try {
                const img = await (upload ? upload(file) : uploadImage(file, purpose));
                onChange({ key: img.key, url: img.url });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Upload failed.");
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X aria-hidden /> Remove
          </Button>
        )}
      </div>
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
