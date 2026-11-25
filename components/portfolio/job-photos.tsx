"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { PortfolioPhotoView } from "@/lib/portfolio/portfolio";
import { cn } from "@/lib/utils";

/**
 * A provider's job photos as a grid of square thumbnails with captions. A tap
 * opens the photo full size, with arrows (and arrow keys) to move through them.
 */
export function JobPhotos({ photos, compact = false }: { photos: PortfolioPhotoView[]; compact?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open !== null && !d.open) d.showModal();
    if (open === null && d.open) d.close();
  }, [open]);

  const step = (by: number) => setOpen((i) => (i === null ? i : (i + by + photos.length) % photos.length));
  const current = open !== null ? photos[open] : null;

  return (
    <>
      <ul className={cn("grid gap-3", compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4")}>
        {photos.map((p, i) => (
          <li key={p.key} className="min-w-0">
            <button type="button" onClick={() => setOpen(i)} className="group block w-full text-left" aria-label={`Open photo: ${p.caption}`}>
              <span className="relative block aspect-square overflow-hidden rounded-xl bg-muted">
                <Image src={p.url} alt={p.caption} fill sizes={compact ? "(min-width: 640px) 160px, 33vw" : "(min-width: 1024px) 220px, (min-width: 640px) 33vw, 50vw"} className="object-cover transition-transform group-hover:scale-105" />
              </span>
              {!compact && <span className="mt-1.5 line-clamp-2 block text-xs text-muted-foreground">{p.caption}</span>}
            </button>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        onClose={() => setOpen(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
        onClick={(e) => e.target === e.currentTarget && setOpen(null)}
        className="m-auto max-h-[92vh] w-[min(960px,94vw)] rounded-2xl bg-background p-0 backdrop:bg-black/80"
        aria-label="Job photo"
      >
        {current && (
          <figure className="flex flex-col">
            <div className="relative h-[70vh] w-full bg-black">
              <Image src={current.url} alt={current.caption} fill sizes="94vw" className="object-contain" />
            </div>
            <figcaption className="flex items-center gap-2 p-3 text-sm">
              <span className="min-w-0 flex-1">
                {current.caption}
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                  {open! + 1} of {photos.length}
                </span>
              </span>
              {photos.length > 1 && (
                <>
                  <button type="button" onClick={() => step(-1)} className="rounded-full p-2 hover:bg-muted" aria-label="Previous photo">
                    <ChevronLeft className="size-5" aria-hidden />
                  </button>
                  <button type="button" onClick={() => step(1)} className="rounded-full p-2 hover:bg-muted" aria-label="Next photo">
                    <ChevronRight className="size-5" aria-hidden />
                  </button>
                </>
              )}
              <button type="button" onClick={() => setOpen(null)} className="rounded-full p-2 hover:bg-muted" aria-label="Close">
                <X className="size-5" aria-hidden />
              </button>
            </figcaption>
          </figure>
        )}
      </dialog>
    </>
  );
}
