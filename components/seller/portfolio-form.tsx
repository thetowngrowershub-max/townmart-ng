"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ImageGalleryInput, type GalleryImage } from "@/components/uploads/image-gallery-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { savePortfolioAction } from "@/lib/portfolio/actions";
import type { PortfolioPhotoView } from "@/lib/portfolio/portfolio";
import { MAX_PORTFOLIO_PHOTOS } from "@/lib/validation/portfolio";

/** Upload, caption, reorder and remove job photos, then save the whole set. */
export function PortfolioForm({ initial }: { initial: PortfolioPhotoView[] }) {
  const router = useRouter();
  const [images, setImages] = useState<GalleryImage[]>(initial.map((p) => ({ key: p.key, url: p.url, width: p.width, height: p.height, altText: p.caption, isCover: false })));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const missingCaption = images.some((i) => i.altText.trim().length < 3);

  const save = () =>
    start(async () => {
      const res = await savePortfolioAction({ photos: images.map((i) => ({ key: i.key, width: i.width, height: i.height, caption: i.altText })) });
      setResult(res.ok ? { ok: true, text: res.message ?? "Saved." } : { ok: false, text: Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.error });
      if (res.ok) router.refresh();
    });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {result && <Alert variant={result.ok ? "success" : "danger"}>{result.text}</Alert>}
      <ImageGalleryInput
        value={images}
        onChange={(next) => {
          setImages(next);
          setResult(null);
        }}
        purpose="portfolio"
        max={MAX_PORTFOLIO_PHOTOS}
        withCover={false}
        altLabel="Caption: what was the job? (e.g. Tiled a kitchen floor in Mowe)"
      />
      {missingCaption && <p className="text-sm text-muted-foreground">Give every photo a short caption before you save.</p>}
      <Button type="submit" disabled={pending || missingCaption} className="self-start">
        {pending ? "Saving…" : "Save job photos"}
      </Button>
    </form>
  );
}
