"use client";

import { ImagePlus, Loader2, Star, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { uploadImage } from "@/components/uploads/upload-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { writeReviewAction } from "@/lib/reviews/actions";
import { cn } from "@/lib/utils";

const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/** Stars, a few words and up to 4 photos. */
export function ReviewForm({ orderItemId }: { orderItemId: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<{ key: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const add = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    try {
      for (const f of [...files].slice(0, 4 - photos.length)) {
        const img = await uploadImage(f, "review");
        setPhotos((p) => [...p, { key: img.key, url: img.url }]);
      }
      setErrors((e) => ({ ...e, imageKeys: "" }));
    } catch (err) {
      setErrors((e) => ({ ...e, imageKeys: err instanceof Error ? err.message : "Upload failed." }));
    } finally {
      setUploading(false);
    }
  };

  const submit = () =>
    start(async () => {
      const res = await writeReviewAction({ orderItemId, rating, body, imageKeys: photos.map((p) => p.key) });
      if (res.ok) router.push(`${res.data!.href}#reviews`);
      else setErrors({ ...Object.fromEntries(Object.entries(res.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""])), _form: res.fieldErrors ? "" : res.error });
    });

  const shown = hover || rating;
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Your rating</legend>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer" onMouseEnter={() => setHover(n)}>
              <input type="radio" name="rating" value={n} className="sr-only" checked={rating === n} onChange={() => setRating(n)} />
              <Star className={cn("size-9 transition-colors", n <= shown ? "fill-accent text-accent" : "text-muted-foreground/40")} aria-hidden />
              <span className="sr-only">
                {n} star{n === 1 ? "" : "s"}
              </span>
            </label>
          ))}
          <span className="ml-2 text-sm text-muted-foreground" aria-live="polite">
            {WORDS[shown]}
          </span>
        </div>
        {errors.rating && <p className="mt-1 text-sm text-danger">{errors.rating}</p>}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-body">Your review</Label>
        <Textarea id="review-body" rows={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What did you like? Was anything not as described?" aria-invalid={Boolean(errors.body)} />
        {errors.body && <p className="text-sm text-danger">{errors.body}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Photos (optional, up to 4)</span>
        <div className="flex flex-wrap gap-3">
          {photos.map((p) => (
            <div key={p.key} className="relative size-20 overflow-hidden rounded-xl bg-muted">
              <Image src={p.url} alt="" fill sizes="80px" className="object-cover" />
              <button type="button" className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white" onClick={() => setPhotos((ps) => ps.filter((x) => x.key !== p.key))} aria-label="Remove photo">
                <X className="size-3" aria-hidden />
              </button>
            </div>
          ))}
          {photos.length < 4 && (
            <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs text-muted-foreground hover:border-primary">
              {uploading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />}
              {uploading ? "Uploading" : "Add"}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={uploading} onChange={(e) => void add(e.target.files)} />
            </label>
          )}
        </div>
        {errors.imageKeys && <p className="text-sm text-danger">{errors.imageKeys}</p>}
        <p className="text-xs text-muted-foreground">Photos are shown with your review. We remove location data from them.</p>
      </div>
      {errors._form && <Alert variant="danger">{errors._form}</Alert>}
      <Button type="submit" disabled={pending || uploading} className="self-start">
        {pending ? "Posting…" : "Post review"}
      </Button>
      <p className="text-xs text-muted-foreground">Your review shows your first name and initial. Reviews must follow our Acceptable Use Policy.</p>
    </form>
  );
}
