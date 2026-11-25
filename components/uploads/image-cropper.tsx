"use client";

import { Crop, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { centredOffset, clampOffset, coverScale, cropRect, frameSize, outputSize, zoomAroundCentre, type Offset, type Size } from "@/lib/images/crop";
import { cn } from "@/lib/utils";

const SHAPES = [
  { id: "square", label: "Square", hint: "How listings show", aspect: 1 },
  { id: "4:3", label: "4:3", hint: "Landscape", aspect: 4 / 3 },
  { id: "original", label: "Original", hint: "Whole shape", aspect: 0 },
] as const;
type ShapeId = (typeof SHAPES)[number]["id"];

const MAX_ZOOM = 4;
const STEP = 10; // px per arrow key press
const EDITOR = 320; // the editor's square area, in CSS pixels

/**
 * Crops one image before it is uploaded. The frame stays still; the image is
 * dragged (or moved with the arrow keys) and zoomed under it, so the crop is
 * always filled. Square is the default because listings show images square.
 * Shown in a modal <dialog>, which keeps focus inside and closes on Escape.
 */
export function ImageCropper({
  source,
  name,
  maxEdge,
  position,
  onCrop,
  onSkip,
  onCancel,
}: {
  source: Blob;
  name: string;
  maxEdge: number;
  /** e.g. "Image 2 of 3", when several files were picked. */
  position?: string;
  onCrop: (blob: Blob) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [shape, setShape] = useState<ShapeId>("square");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [working, setWorking] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; start: Offset } | null>(null);

  // Decode once, with the camera's orientation applied, for both preview and output.
  useEffect(() => {
    let live = true;
    let made: ImageBitmap | null = null;
    const objectUrl = URL.createObjectURL(source);
    setUrl(objectUrl);
    createImageBitmap(source, { imageOrientation: "from-image" })
      .then((b) => {
        made = b;
        if (live) setBitmap(b);
        else b.close();
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      URL.revokeObjectURL(objectUrl);
      made?.close();
    };
  }, [source]);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  const image: Size | null = bitmap ? { width: bitmap.width, height: bitmap.height } : null;
  const aspect = shape === "original" && image ? image.width / image.height : (SHAPES.find((s) => s.id === shape)?.aspect ?? 1);
  const frame = frameSize({ width: EDITOR, height: EDITOR }, aspect);
  const base = image ? coverScale(image, frame) : 1;
  const scale = base * zoom;

  // A new shape (or a newly loaded image) starts centred at zoom 1.
  useEffect(() => {
    if (!image) return;
    setZoom(1);
    setOffset(centredOffset(image, frame, coverScale(image, frame)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the shape or image changes
  }, [shape, bitmap]);

  const move = (next: Offset) => image && setOffset(clampOffset(next, image, frame, scale));
  const zoomTo = (z: number) => {
    if (!image) return;
    const to = Math.min(MAX_ZOOM, Math.max(1, z));
    setOffset(zoomAroundCentre(offset, image, frame, scale, base * to));
    setZoom(to);
  };

  async function apply() {
    if (!bitmap || !image) return;
    setWorking(true);
    try {
      const rect = cropRect(offset, image, frame, scale);
      const out = outputSize(rect, maxEdge);
      const canvas = document.createElement("canvas");
      canvas.width = out.width;
      canvas.height = out.height;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
      if (blob) onCrop(blob);
      else onSkip(); // the browser can't encode: keep the whole image
    } finally {
      setWorking(false);
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    const d = { ArrowLeft: [STEP, 0], ArrowRight: [-STEP, 0], ArrowUp: [0, STEP], ArrowDown: [0, -STEP] }[e.key];
    if (d) {
      e.preventDefault();
      move({ x: offset.x + d[0]!, y: offset.y + d[1]! });
    } else if (e.key === "+" || e.key === "=") zoomTo(zoom + 0.25);
    else if (e.key === "-") zoomTo(zoom - 0.25);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-help`}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(100vw-2rem,26rem)] rounded-2xl border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-4 p-4">
        <div>
          <h2 id={`${ids}-title`} className="text-lg font-semibold">
            Crop image{position ? <span className="font-normal text-muted-foreground"> · {position}</span> : null}
          </h2>
          <p id={`${ids}-help`} className="text-sm text-muted-foreground">
            Drag the photo, or use the arrow keys, to choose what shows. <span className="sr-only">Plus and minus zoom.</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">{name}</p>
        </div>

        <fieldset className="flex gap-2">
          <legend className="sr-only">Shape</legend>
          {SHAPES.map((s) => (
            <label
              key={s.id}
              className={cn(
                "flex flex-1 cursor-pointer flex-col items-center rounded-xl border px-2 py-1.5 text-center text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                shape === s.id && "border-primary bg-primary-soft",
              )}
            >
              <input type="radio" name={`${ids}-shape`} value={s.id} checked={shape === s.id} onChange={() => setShape(s.id)} className="sr-only" />
              <span className="font-medium">{s.label}</span>
              <span className="text-[11px] text-muted-foreground">{s.hint}</span>
            </label>
          ))}
        </fieldset>

        <div className="grid place-items-center rounded-xl bg-muted" style={{ height: EDITOR + 16 }}>
          {failed ? (
            <p className="px-4 text-center text-sm text-muted-foreground">This image can&apos;t be cropped in your browser. You can upload it as it is.</p>
          ) : !image || !url ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading image" />
          ) : (
            <div
              role="group"
              aria-roledescription="crop area"
              aria-label="Crop area. Arrow keys move the photo."
              tabIndex={0}
              onKeyDown={onKey}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: offset };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (d && d.id === e.pointerId) move({ x: d.start.x + e.clientX - d.x, y: d.start.y + e.clientY - d.y });
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onWheel={(e) => zoomTo(zoom - Math.sign(e.deltaY) * 0.1)}
              className="relative cursor-move touch-none overflow-hidden rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
              style={{ width: frame.width, height: frame.height }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a file not yet uploaded */}
              <img
                src={url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute top-0 left-0 max-w-none select-none"
                style={{ width: image.width * scale, height: image.height * scale, transform: `translate(${offset.x}px, ${offset.y}px)` }}
              />
              {/* Rule-of-thirds guide */}
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3" aria-hidden>
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} className="border border-white/40" />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" aria-label="Zoom out" disabled={!image || zoom <= 1} onClick={() => zoomTo(zoom - 0.25)}>
            <ZoomOut aria-hidden />
          </Button>
          <label htmlFor={`${ids}-zoom`} className="sr-only">
            Zoom
          </label>
          <input
            id={`${ids}-zoom`}
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={!image}
            onChange={(e) => zoomTo(Number(e.target.value))}
            aria-valuetext={`${Math.round(zoom * 100)}%`}
            className="flex-1 accent-primary"
          />
          <Button type="button" variant="ghost" size="icon" aria-label="Zoom in" disabled={!image || zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom + 0.25)}>
            <ZoomIn aria-hidden />
          </Button>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Don&apos;t add
          </Button>
          <Button type="button" variant="outline" onClick={onSkip}>
            Use whole image
          </Button>
          <Button type="button" onClick={apply} disabled={!image || working}>
            {working ? <Loader2 className="animate-spin" aria-hidden /> : <Crop aria-hidden />} Crop and add
          </Button>
        </div>
      </div>
    </dialog>
  );
}
