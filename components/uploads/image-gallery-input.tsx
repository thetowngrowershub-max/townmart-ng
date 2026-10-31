"use client";

import { ArrowLeft, ArrowRight, Crop, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ImagePurpose } from "@/lib/storage/uploads";
import { cn } from "@/lib/utils";
import { ImageCropper } from "./image-cropper";
import { MAX_EDGE, uploadImage } from "./upload-client";

export type GalleryImage = { key: string; url: string; width: number; height: number; altText: string; isCover: boolean };

/**
 * Multi-image upload: drag-and-drop or pick, crop each picked image (square
 * by default, as listings show them), reorder (drag or arrow buttons), choose
 * the cover, and write alt text for each. An uploaded image can be cropped
 * again. Uploads run in the background while the next image is cropped and go
 * straight to storage via presigned URLs.
 */
export function ImageGalleryInput({
  value,
  onChange,
  purpose,
  max = 8,
  withCover = true,
  error,
}: {
  value: GalleryImage[];
  onChange: (next: GalleryImage[]) => void;
  purpose: Extract<ImagePurpose, "product" | "service">;
  max?: number;
  withCover?: boolean;
  error?: string;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);
  // Images waiting to be cropped, one at a time. `replace` re-crops an uploaded image in place.
  const [queue, setQueue] = useState<{ file: Blob; name: string; replace?: string }[]>([]);
  const [queued, setQueued] = useState(0);
  // Uploads finish out of order; always append to the latest list.
  const latest = useRef(value);
  latest.current = value;

  const ensureCover = (list: GalleryImage[]) =>
    withCover && list.length > 0 && !list.some((i) => i.isCover) ? list.map((i, n) => ({ ...i, isCover: n === 0 })) : list;

  function addFiles(files: FileList | File[]) {
    setUploadError(null);
    const room = max - latest.current.length - uploading - queue.length;
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (picked.length === 0) {
      setUploadError(room <= 0 ? `You can add up to ${max} images.` : "Choose JPEG, PNG or WebP images.");
      return;
    }
    setQueue((q) => [...q, ...picked.map((file) => ({ file, name: file.name }))]);
    setQueued((n) => (queue.length === 0 ? picked.length : n + picked.length));
  }

  async function upload(body: Blob, name: string, replace?: string) {
    setUploading((n) => n + 1);
    try {
      const img = await uploadImage(new File([body], name, { type: body.type }), purpose);
      if (replace) {
        onChange(latest.current.map((i) => (i.key === replace ? { ...i, ...img } : i)));
      } else {
        const alt = name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").slice(0, 120);
        onChange(ensureCover([...latest.current, { ...img, altText: alt.length >= 3 ? alt : "", isCover: false }]));
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading((n) => n - 1);
    }
  }

  async function recrop(img: GalleryImage) {
    setUploadError(null);
    try {
      const res = await fetch(img.url);
      if (!res.ok) throw new Error();
      const file = await res.blob();
      setQueued(1);
      setQueue((q) => [...q, { file, name: img.altText || "image", replace: img.key }]);
    } catch {
      setUploadError("That image couldn't be opened for cropping. Remove it and add it again.");
    }
  }

  const current = queue[0];
  const next = () => setQueue((q) => q.slice(1));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length || from === to) return;
    const next = [...value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  const update = (i: number, patch: Partial<GalleryImage>) => onChange(value.map((img, n) => (n === i ? { ...img, ...patch } : img)));
  const setCover = (i: number) => onChange(value.map((img, n) => ({ ...img, isCover: n === i })));
  const remove = (i: number) => onChange(ensureCover(value.filter((_, n) => n !== i)));

  return (
    <div className="flex flex-col gap-3">
      {current && (
        <ImageCropper
          key={`${queued}-${queue.length}`}
          source={current.file}
          name={current.name}
          maxEdge={MAX_EDGE[purpose]}
          position={queued > 1 ? `${queued - queue.length + 1} of ${queued}` : undefined}
          onCrop={(blob) => {
            void upload(blob, current.name, current.replace);
            next();
          }}
          onSkip={() => {
            if (!current.replace) void upload(current.file, current.name);
            next();
          }}
          onCancel={next}
        />
      )}
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDropActive(true);
          }
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            setDropActive(false);
            addFiles(e.dataTransfer.files);
          }
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-input p-6 text-center text-sm",
          dropActive && "border-primary bg-primary-soft",
        )}
      >
        <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
        <p>
          Drag images here, or{" "}
          <button type="button" className="font-semibold text-primary underline" onClick={() => fileRef.current?.click()}>
            choose files
          </button>
        </p>
        <p className="text-xs text-muted-foreground">
          JPEG, PNG or WebP, up to {max} images. You can crop each one; we resize them and remove location data.
        </p>
        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {uploading > 0 && (
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Uploading {uploading} image{uploading === 1 ? "" : "s"}…
          </p>
        )}
      </div>
      {(uploadError || error) && <p className="text-xs font-medium text-danger">{uploadError ?? error}</p>}

      {value.length > 0 && (
        <ol className="grid gap-3 sm:grid-cols-2">
          {value.map((img, i) => (
            <li
              key={img.key}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => dragIndex !== null && e.preventDefault()}
              onDrop={(e) => {
                if (dragIndex !== null) {
                  e.preventDefault();
                  move(dragIndex, i);
                  setDragIndex(null);
                }
              }}
              className={cn("flex gap-3 rounded-2xl border bg-card p-3", img.isCover && withCover && "border-primary")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of an uploaded image */}
              <img src={img.url} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <label className="text-xs font-medium" htmlFor={`${inputId}-alt-${i}`}>
                  Alt text (describe the image)
                </label>
                <Input
                  id={`${inputId}-alt-${i}`}
                  value={img.altText}
                  maxLength={160}
                  onChange={(e) => update(i, { altText: e.target.value })}
                  aria-invalid={img.altText.trim().length < 3 || undefined}
                  className="h-9"
                />
                <div className="flex flex-wrap gap-1">
                  {withCover && (
                    <Button type="button" size="sm" variant={img.isCover ? "default" : "outline"} onClick={() => setCover(i)} aria-pressed={img.isCover}>
                      <Star aria-hidden /> {img.isCover ? "Cover" : "Make cover"}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" onClick={() => void recrop(img)} aria-label={`Crop image ${i + 1}`}>
                    <Crop aria-hidden />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move earlier">
                    <ArrowLeft aria-hidden />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => move(i, i + 1)} disabled={i === value.length - 1} aria-label="Move later">
                    <ArrowRight aria-hidden />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} aria-label="Remove image">
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
