"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionAlert, useAction } from "@/components/admin/use-action";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SingleImageInput } from "@/components/uploads/single-image-input";
import { uploadCmsBanner } from "@/components/uploads/upload-client";
import { deleteBannerAction, deleteFaqAction, saveBannerAction, saveCmsPageAction, saveFaqAction, saveFeaturedStoresAction } from "@/lib/admin/cms-actions";

// ─── Banners ────────────────────────────────────────────────────────────────

export type BannerValues = {
  id?: string;
  title: string;
  subtitle: string;
  image: { key: string; url: string } | null;
  linkUrl: string;
  ctaLabel: string;
  sortOrder: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

export function BannerForm({ initial }: { initial: BannerValues }) {
  const { result, pending, run, fieldError } = useAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof BannerValues>(k: K, value: BannerValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const p = v.id ?? "new";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const { image, ...rest } = v;
        run(() => saveBannerAction({ ...rest, imageKey: image?.key ?? "" }), () => !v.id && setV(initial));
      }}
    >
      <ActionAlert result={result} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={`${p}-title`} label="Headline" error={fieldError("title")}>
          <Input value={v.title} onChange={(e) => set("title", e.target.value)} required maxLength={80} />
        </FormField>
        <FormField id={`${p}-subtitle`} label="Supporting line (optional)" error={fieldError("subtitle")}>
          <Input value={v.subtitle} onChange={(e) => set("subtitle", e.target.value)} maxLength={160} />
        </FormField>
        <FormField id={`${p}-link`} label="Link (optional)" hint="A TownMart path like /deals, or an https:// link." error={fieldError("linkUrl")}>
          <Input value={v.linkUrl} onChange={(e) => set("linkUrl", e.target.value)} maxLength={300} />
        </FormField>
        <FormField id={`${p}-cta`} label="Button label (optional)" error={fieldError("ctaLabel")}>
          <Input value={v.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} maxLength={30} placeholder="e.g. Shop the sale" />
        </FormField>
        <FormField id={`${p}-from`} label="Show from (optional)" hint="Lagos time." error={fieldError("startsAt")}>
          <Input type="datetime-local" value={v.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
        </FormField>
        <FormField id={`${p}-to`} label="Show until (optional)" error={fieldError("endsAt")}>
          <Input type="datetime-local" value={v.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
        </FormField>
        <FormField id={`${p}-sort`} label="Position" hint="Lower numbers come first." error={fieldError("sortOrder")}>
          <Input inputMode="numeric" value={v.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
        </FormField>
      </div>
      <SingleImageInput label="Image (optional)" hint="Wide, 3:1. Text stays readable without it." purpose="banner" value={v.image} onChange={(img) => set("image", img)} upload={uploadCmsBanner} />
      {fieldError("imageKey") && <p className="text-xs font-medium text-danger">{fieldError("imageKey")}</p>}
      <Checkbox id={`${p}-active`} label="Show on the homepage" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : v.id ? "Save banner" : "Add banner"}
        </Button>
        {v.id && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(`Delete the “${v.title}” banner?`) && run(() => deleteBannerAction({ id: v.id! }))}>
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

// ─── Featured stores ────────────────────────────────────────────────────────

export function FeaturedStoresForm({ initial, stores }: { initial: string[]; stores: { id: string; name: string; city: string }[] }) {
  const { result, pending, run } = useAction();
  const [ids, setIds] = useState(initial);
  const [adding, setAdding] = useState("");
  const store = (id: string) => stores.find((s) => s.id === id);
  const move = (i: number, d: -1 | 1) =>
    setIds((xs) => {
      const next = [...xs];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      return next;
    });
  return (
    <div className="flex flex-col gap-4">
      <ActionAlert result={result} />
      {ids.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stores featured. The homepage skips the section.</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-xl border">
          {ids.map((id, i) => (
            <li key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-6 text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="flex-1">
                <span className="font-medium">{store(id)?.name ?? "Store no longer approved"}</span>
                <span className="block text-xs text-muted-foreground">{store(id)?.city}</span>
              </span>
              <Button type="button" variant="ghost" size="icon" aria-label={`Move ${store(id)?.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Move ${store(id)?.name} down`} disabled={i === ids.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${store(id)?.name}`} onClick={() => setIds((xs) => xs.filter((x) => x !== id))}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {ids.length < 12 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <FormField id="add-store" label="Add a store">
              <Select value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Choose an approved store…</option>
                {stores
                  .filter((s) => !ids.includes(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.city})
                    </option>
                  ))}
              </Select>
            </FormField>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!adding}
            onClick={() => {
              setIds((xs) => [...xs, adding]);
              setAdding("");
            }}
          >
            Add
          </Button>
        </div>
      )}
      <Button className="self-start" disabled={pending} onClick={() => run(() => saveFeaturedStoresAction({ businessIds: ids.filter((id) => store(id)) }))}>
        {pending ? "Saving…" : "Save featured stores"}
      </Button>
    </div>
  );
}

// ─── Help centre ────────────────────────────────────────────────────────────

export type FaqValues = { id?: string; section: string; question: string; answerHtml: string; sortOrder: string; isPublished: boolean };

export function FaqForm({ initial, sections }: { initial: FaqValues; sections: string[] }) {
  const { result, pending, run, fieldError } = useAction();
  const [v, setV] = useState(initial);
  // Remounts the editor after a new question is added, so it starts empty.
  const [round, setRound] = useState(0);
  const set = <K extends keyof FaqValues>(k: K, value: FaqValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const p = v.id ?? "new";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveFaqAction(v),
          () => {
            if (!v.id) {
              setV(initial);
              setRound((r) => r + 1);
            }
          },
        );
      }}
    >
      <ActionAlert result={result} />
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr_6rem]">
        <FormField id={`${p}-section`} label="Section" error={fieldError("section")}>
          <Input value={v.section} onChange={(e) => set("section", e.target.value)} list="faq-sections" maxLength={60} />
        </FormField>
        <FormField id={`${p}-q`} label="Question" error={fieldError("question")}>
          <Input value={v.question} onChange={(e) => set("question", e.target.value)} maxLength={200} />
        </FormField>
        <FormField id={`${p}-sort`} label="Position" error={fieldError("sortOrder")}>
          <Input inputMode="numeric" value={v.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
        </FormField>
      </div>
      <datalist id="faq-sections">
        {sections.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${p}-answer`} className="text-sm font-medium">
          Answer
        </label>
        <RichTextEditor key={round} id={`${p}-answer`} value={v.answerHtml} onChange={(html) => set("answerHtml", html)} invalid={Boolean(fieldError("answerHtml"))} />
        {fieldError("answerHtml") && <p className="text-xs font-medium text-danger">{fieldError("answerHtml")}</p>}
      </div>
      <Checkbox id={`${p}-pub`} label="Published" checked={v.isPublished} onChange={(e) => set("isPublished", e.target.checked)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : v.id ? "Save" : "Add question"}
        </Button>
        {v.id && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Delete this question?") && run(() => deleteFaqAction({ id: v.id! }))}>
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

// ─── Pages ──────────────────────────────────────────────────────────────────

export function CmsPageForm({ initial }: { initial: { slug: "about" | "contact"; title: string; summary: string; bodyHtml: string } }) {
  const { result, pending, run, fieldError } = useAction();
  const [v, setV] = useState(initial);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveCmsPageAction(v));
      }}
    >
      <ActionAlert result={result} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={`${v.slug}-title`} label="Title" error={fieldError("title")}>
          <Input value={v.title} onChange={(e) => setV((s) => ({ ...s, title: e.target.value }))} maxLength={80} />
        </FormField>
        <FormField id={`${v.slug}-summary`} label="Summary" hint="Shown under the title and in search results." error={fieldError("summary")}>
          <Input value={v.summary} onChange={(e) => setV((s) => ({ ...s, summary: e.target.value }))} maxLength={200} />
        </FormField>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${v.slug}-body`} className="text-sm font-medium">
          Page
        </label>
        <RichTextEditor id={`${v.slug}-body`} value={v.bodyHtml} onChange={(html) => setV((s) => ({ ...s, bodyHtml: html }))} invalid={Boolean(fieldError("bodyHtml"))} />
        {fieldError("bodyHtml") && <p className="text-xs font-medium text-danger">{fieldError("bodyHtml")}</p>}
      </div>
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Save page"}
      </Button>
    </form>
  );
}
