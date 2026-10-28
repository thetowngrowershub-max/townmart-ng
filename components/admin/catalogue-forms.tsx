"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionAlert, useAction } from "@/components/admin/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  addCommissionRuleAction,
  deleteAttributeAction,
  deleteCommissionRuleAction,
  saveAttributeAction,
  saveCategoryAction,
  saveCategoryAttributesAction,
  savePlatformSettingsAction,
  saveZoneAction,
} from "@/lib/admin/catalogue-actions";
import { PLATFORM_SETTINGS } from "@/lib/validation/catalogue-admin";

type Option = { id: string; name: string };

// ─── Categories ─────────────────────────────────────────────────────────────

export type CategoryValues = { id?: string; name: string; slug: string; kind: "product" | "service"; parentId: string; icon: string; sortOrder: string; isActive: boolean };

export function CategoryForm({ initial, parents }: { initial: CategoryValues; parents: (Option & { kind: string })[] }) {
  const router = useRouter();
  const { result, pending, run, fieldError } = useAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof CategoryValues>(k: K, value: CategoryValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const choices = parents.filter((p) => p.kind === v.kind && p.id !== v.id);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const res = await saveCategoryAction(v);
          if (res.ok && !v.id && res.data) router.push(`/admin/catalogue/categories/${res.data.id}`);
          return res;
        });
      }}
    >
      <ActionAlert result={result} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="cat-name" label="Name" error={fieldError("name")}>
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={60} />
        </FormField>
        <FormField id="cat-slug" label="Web address" hint="Leave empty to make one from the name." error={fieldError("slug")}>
          <Input value={v.slug} onChange={(e) => set("slug", e.target.value)} maxLength={80} placeholder="e.g. womens-fashion" />
        </FormField>
        <FormField id="cat-kind" label="For" error={fieldError("kind")}>
          <Select value={v.kind} onChange={(e) => setV((s) => ({ ...s, kind: e.target.value as CategoryValues["kind"], parentId: "" }))}>
            <option value="product">Products</option>
            <option value="service">Services</option>
          </Select>
        </FormField>
        <FormField id="cat-parent" label="Inside" error={fieldError("parentId")}>
          <Select value={v.parentId} onChange={(e) => set("parentId", e.target.value)}>
            <option value="">Nothing (top level)</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="cat-icon" label="Icon" hint="A Lucide icon name, e.g. shirt or wrench." error={fieldError("icon")}>
          <Input value={v.icon} onChange={(e) => set("icon", e.target.value)} maxLength={40} />
        </FormField>
        <FormField id="cat-sort" label="Position" hint="Lower numbers come first." error={fieldError("sortOrder")}>
          <Input inputMode="numeric" value={v.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
        </FormField>
      </div>
      <Checkbox id="cat-active" label="Shown to shoppers and sellers" hint="Hidden categories keep their listings, but sellers can't choose them for new ones." checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} />
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Saving…" : v.id ? "Save category" : "Create category"}
      </Button>
    </form>
  );
}

export function CategoryAttributesForm({ categoryId, initial, attributes }: { categoryId: string; initial: { attributeId: string; isRequired: boolean }[]; attributes: (Option & { type: string })[] }) {
  const { result, pending, run } = useAction();
  const [items, setItems] = useState(initial);
  const [adding, setAdding] = useState("");
  const name = (id: string) => attributes.find((a) => a.id === id);
  const available = attributes.filter((a) => !items.some((i) => i.attributeId === a.id));
  const move = (i: number, d: -1 | 1) =>
    setItems((xs) => {
      const next = [...xs];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      return next;
    });
  return (
    <div className="flex flex-col gap-4">
      <ActionAlert result={result} />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attributes yet. Sellers only fill in the standard fields.</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-xl border">
          {items.map((it, i) => (
            <li key={it.attributeId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-32 flex-1 font-medium">
                {name(it.attributeId)?.name} <span className="font-normal text-muted-foreground">({name(it.attributeId)?.type})</span>
              </span>
              <Checkbox id={`req-${it.attributeId}`} label="Required" checked={it.isRequired} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, isRequired: e.target.checked } : x)))} />
              <span className="flex gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label={`Move ${name(it.attributeId)?.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Move ${name(it.attributeId)?.name} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${name(it.attributeId)?.name}`} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <FormField id="add-attr" label="Add an attribute">
              <Select value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Choose…</option>
                {available.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
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
              setItems((xs) => [...xs, { attributeId: adding, isRequired: false }]);
              setAdding("");
            }}
          >
            Add
          </Button>
        </div>
      )}
      <Button className="self-start" disabled={pending} onClick={() => run(() => saveCategoryAttributesAction({ categoryId, items }))}>
        {pending ? "Saving…" : "Save attributes"}
      </Button>
    </div>
  );
}

// ─── Attributes ─────────────────────────────────────────────────────────────

export type AttributeValues = { id?: string; name: string; slug: string; type: "text" | "number" | "select"; options: string };

export function AttributeForm({ initial, used = 0 }: { initial: AttributeValues; used?: number }) {
  const { result, pending, run, fieldError } = useAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof AttributeValues>(k: K, value: AttributeValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const prefix = v.id ?? "new";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveAttributeAction(v), () => !v.id && setV(initial));
      }}
    >
      <ActionAlert result={result} />
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id={`${prefix}-name`} label="Name" error={fieldError("name")}>
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={60} placeholder="e.g. Screen size" />
        </FormField>
        <FormField id={`${prefix}-slug`} label="Key" hint={v.id ? "Fixed once created." : "Leave empty to make one from the name."} error={fieldError("slug")}>
          <Input value={v.slug} onChange={(e) => set("slug", e.target.value)} disabled={Boolean(v.id)} maxLength={80} />
        </FormField>
        <FormField id={`${prefix}-type`} label="Type" error={fieldError("type")}>
          <Select value={v.type} onChange={(e) => set("type", e.target.value as AttributeValues["type"])}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="select">Choose from a list</option>
          </Select>
        </FormField>
      </div>
      {v.type === "select" && (
        <FormField id={`${prefix}-options`} label="Options" hint="One per line." error={fieldError("options")}>
          <Textarea rows={4} value={v.options} onChange={(e) => set("options", e.target.value)} />
        </FormField>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : v.id ? "Save" : "Create attribute"}
        </Button>
        {v.id && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending || used > 0}
            title={used ? "Remove it from its categories first" : undefined}
            onClick={() => window.confirm(`Delete “${v.name}”? Values sellers already entered stay on their listings but aren't shown.`) && run(() => deleteAttributeAction({ id: v.id! }))}
          >
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

// ─── Commission ─────────────────────────────────────────────────────────────

export function CommissionRuleForm({ categories, sellers }: { categories: Option[]; sellers: Option[] }) {
  const empty = { scope: "category" as "global" | "category" | "business", categoryId: "", businessId: "", percent: "", fixed: "", effectiveFrom: "" };
  const { result, pending, run, fieldError } = useAction();
  const [v, setV] = useState(empty);
  const set = <K extends keyof typeof empty>(k: K, value: (typeof empty)[K]) => setV((s) => ({ ...s, [k]: value }));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addCommissionRuleAction(v), () => setV(empty));
      }}
    >
      <ActionAlert result={result} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="rule-scope" label="Applies to">
          <Select value={v.scope} onChange={(e) => set("scope", e.target.value as typeof v.scope)}>
            <option value="global">Every sale (global)</option>
            <option value="category">A category</option>
            <option value="business">One seller</option>
          </Select>
        </FormField>
        {v.scope === "category" && (
          <FormField id="rule-category" label="Category" error={fieldError("categoryId")}>
            <Select value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        {v.scope === "business" && (
          <FormField id="rule-seller" label="Seller" error={fieldError("businessId")}>
            <Select value={v.businessId} onChange={(e) => set("businessId", e.target.value)}>
              <option value="">Choose…</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField id="rule-percent" label="Commission (%)" error={fieldError("percent")}>
          <Input inputMode="decimal" value={v.percent} onChange={(e) => set("percent", e.target.value)} placeholder="e.g. 7.5" required />
        </FormField>
        <FormField id="rule-fixed" label="Plus a fixed fee per order (₦)" hint="Optional." error={fieldError("fixed")}>
          <Input inputMode="decimal" value={v.fixed} onChange={(e) => set("fixed", e.target.value)} placeholder="0" />
        </FormField>
        <FormField id="rule-from" label="Starts" hint="Leave empty to start now. Lagos time." error={fieldError("effectiveFrom")}>
          <Input type="datetime-local" value={v.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} />
        </FormField>
      </div>
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Adding…" : "Add rule"}
      </Button>
    </form>
  );
}

export function DeleteRuleButton({ id, label }: { id: string; label: string }) {
  const { result, pending, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(`Remove the ${label} rule? New orders use the next rule that applies.`) && run(() => deleteCommissionRuleAction({ id }))}>
        Remove
      </Button>
      {result && !result.ok && <span className="text-xs text-danger">{result.error}</span>}
    </span>
  );
}

// ─── Delivery zones ─────────────────────────────────────────────────────────

export type ZoneValues = { id?: string; name: string; stateIds: number[]; priority: string; isActive: boolean };

export function ZoneForm({ initial, states }: { initial: ZoneValues; states: { id: number; name: string }[] }) {
  const router = useRouter();
  const { result, pending, run, fieldError } = useAction();
  const [v, setV] = useState(initial);
  const toggle = (id: number, on: boolean) => setV((s) => ({ ...s, stateIds: on ? [...s.stateIds, id] : s.stateIds.filter((x) => x !== id) }));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const res = await saveZoneAction(v);
          if (res.ok && !v.id && res.data) router.push(`/admin/catalogue/delivery/${res.data.id}`);
          return res;
        });
      }}
    >
      <ActionAlert result={result} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="zone-name" label="Name" error={fieldError("name")}>
          <Input value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} required maxLength={60} placeholder="e.g. South West" />
        </FormField>
        <FormField id="zone-priority" label="Priority" hint="When states overlap, the lowest number wins." error={fieldError("priority")}>
          <Input inputMode="numeric" value={v.priority} onChange={(e) => setV((s) => ({ ...s, priority: e.target.value }))} />
        </FormField>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">States in this zone</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          {states.map((s) => (
            <Checkbox key={s.id} id={`state-${s.id}`} label={s.name} checked={v.stateIds.includes(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} />
          ))}
        </div>
        {fieldError("stateIds") && <p className="text-xs font-medium text-danger">{fieldError("stateIds")}</p>}
      </fieldset>
      <Checkbox id="zone-active" label="In use" hint="Inactive zones aren't offered at checkout." checked={v.isActive} onChange={(e) => setV((s) => ({ ...s, isActive: e.target.checked }))} />
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Saving…" : v.id ? "Save zone" : "Create zone"}
      </Button>
    </form>
  );
}

// ─── Platform settings ──────────────────────────────────────────────────────

export function PlatformSettingsForm({ initial }: { initial: Record<string, string | boolean> }) {
  const { result, pending, run, fieldError } = useAction();
  const [v, setV] = useState(initial);
  const groups = [...new Set(PLATFORM_SETTINGS.map((s) => s.group))];
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => savePlatformSettingsAction(v));
      }}
    >
      <ActionAlert result={result} />
      {groups.map((g) => (
        <fieldset key={g} className="flex flex-col gap-4">
          <legend className="mb-1 font-heading text-base font-semibold">{g}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {PLATFORM_SETTINGS.filter((s) => s.group === g).map((s) =>
              "boolean" in s ? (
                <Checkbox key={s.key} id={s.key} label={s.label} hint={s.hint} checked={v[s.key] === true} onChange={(e) => setV((x) => ({ ...x, [s.key]: e.target.checked }))} />
              ) : (
                <FormField key={s.key} id={s.key} label={s.label} hint={s.hint} error={fieldError(s.key)}>
                  <Input inputMode="decimal" value={String(v[s.key] ?? "")} onChange={(e) => setV((x) => ({ ...x, [s.key]: e.target.value }))} />
                </FormField>
              ),
            )}
          </div>
        </fieldset>
      ))}
      <Button type="submit" className="self-start" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
