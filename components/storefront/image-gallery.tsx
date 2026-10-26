"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type GalleryItem = { url: string; alt: string; width: number; height: number };

/** Main image with hover/tap zoom and a thumbnail strip. `activeIndex` lets a variant pick its image. */
export function ImageGallery({ images, activeIndex, onSelect }: { images: GalleryItem[]; activeIndex: number; onSelect: (i: number) => void }) {
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const current = images[activeIndex] ?? images[0];
  if (!current) return <div className="aspect-square rounded-2xl bg-muted" aria-label="No image" />;

  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className="relative aspect-square cursor-zoom-in overflow-hidden rounded-2xl bg-muted"
        aria-label={zoom ? "Zoom out" : "Zoom in"}
        onPointerMove={(e) => e.pointerType === "mouse" && move(e)}
        onPointerLeave={() => setZoom(null)}
        onClick={(e) => (zoom ? setZoom(null) : move(e as unknown as React.PointerEvent<HTMLButtonElement>))}
      >
        <Image
          src={current.url}
          alt={current.alt}
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-contain transition-transform duration-150"
          style={zoom ? { transform: "scale(2)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
        />
      </button>
      {images.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto" aria-label="Product images">
          {images.map((img, i) => (
            <li key={img.url} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-label={`Show image ${i + 1}: ${img.alt}`}
                aria-pressed={i === activeIndex}
                className={cn("relative block size-16 overflow-hidden rounded-xl border-2 bg-muted", i === activeIndex ? "border-primary" : "border-transparent")}
              >
                <Image src={img.url} alt="" fill sizes="64px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
