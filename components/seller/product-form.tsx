"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFieldArray, useWatch } from "react-hook-form";
import { useActionForm } from "@/components/auth/use-action-form";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { ImageGalleryInput, type GalleryImage } from "@/components/uploads/image-gallery-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveProductAction } from "@/lib/catalogue/actions";
import { UNITS } from "@/lib/catalogue/units";
import { productInputSchema, type ProductInput } from "@/lib/validation/catalogue";

export type CategoryOption = { id: string; name: string; children: { id: string; name: string }[] };
export type ProductFormValues = Omit<ProductInput, "images"> & { images: GalleryImage[] };

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

/** Every combination of option values, in option order. */
function combinations(options: { name: string; values: string[] }[]): Record<string, string>[] {
  return options.reduce<Record<string, string>[]>(
    (acc, o) => acc.flatMap((combo) => o.values.map((v) => ({ ...combo, [o.name]: v }))),
    [{}],
  );
}
const splitValues = (s: string | undefined) =>
  (s ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const comboKey = (ov: Record<string, string>, names: string[]) => names.map((n) => ov[n] ?? "").join("|");
const skuPart = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6);

export function ProductForm({
  productId,
  categories,
  initial,
}: {
  productId: string | null;
  categories: CategoryOption[];
  initial: ProductFormValues;
}) {
  const router = useRouter();
  const { form, onSubmit, pending, result } = useActionForm(
    productInputSchema,
    async (values) => {
      const res = await saveProductAction(productId, values);
      if (res.ok && res.data) {
        if (!productId) router.push(`/dashboard/products/${res.data.id}?saved=1`);
        else router.refresh();
      }
      return res;
    },
    initial as ProductInput,
  );
  const errors = form.formState.errors;
  const options = useFieldArray({ control: form.control, name: "options" });
  const variants = useFieldArray({ control: form.control, name: "variants", keyName: "_key" });
  const watched = useWatch({ control: form.control, name: ["options", "unit", "isPerishable", "images", "title", "variants"] });
  const [optionValues, unit, isPerishable, images, title, variantValues] = watched as [
    ProductInput["options"],
    ProductInput["unit"],
    boolean,
    GalleryImage[],
    string,
    ProductInput["variants"],
  ];
  const fractionalUnit = UNITS.find((u) => u.value === unit)?.fractional ?? false;

  /** Rebuild the variant list from the options, keeping rows whose option values still exist. */
  function regenerateVariants() {
    const opts = (form.getValues("options") ?? []).map((o) => ({ name: o.name.trim(), values: splitValues(o.values as string | undefined) })).filter((o) => o.name && o.values.length);
    const names = opts.map((o) => o.name);
    const current = form.getValues("variants");
    const byKey = new Map(current.map((v) => [comboKey(v.optionValues, names), v]));
    const template = current[0];
    const base = skuPart(form.getValues("title") || "ITEM") || "ITEM";
    const next = combinations(opts).map((ov) => {
      const existing = byKey.get(comboKey(ov, names));
      if (existing) return { ...existing, optionValues: ov };
      return {
        sku: [base, ...names.map((n) => skuPart(ov[n] ?? ""))].filter(Boolean).join("-"),
        barcode: "",
        optionValues: ov,
        price: template?.price ?? "",
        compareAtPrice: "",
        stockQty: "0",
        lowStockThreshold: template?.lowStockThreshold ?? "5",
        imageKey: "",
      };
    });
    variants.replace(next.length ? next : [{ ...(template ?? { sku: base, price: "", stockQty: "0", lowStockThreshold: "5" }), optionValues: {} }]);
  }

  const categoryError = errors.categoryId?.message;
  const optionNames = (optionValues ?? []).map((o) => o.name).filter(Boolean);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6 pb-24">
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      {result?.ok && <Alert variant="success">{result.message}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormField id="title" label="Title" error={errors.title?.message}>
            <Input {...form.register("title")} placeholder="e.g. Ofada rice, 5 kg bag" />
          </FormField>
          <div className="flex flex-col gap-2">
            <label htmlFor="descriptionHtml" className="text-sm font-medium">
              Description
            </label>
            <RichTextEditor
              id="descriptionHtml"
              value={form.getValues("descriptionHtml") ?? ""}
              onChange={(html) => form.setValue("descriptionHtml", html, { shouldDirty: true })}
              invalid={!!errors.descriptionHtml}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField id="categoryId" label="Category" error={categoryError}>
              <Select {...form.register("categoryId")}>
                <option value="">Choose…</option>
                {categories.map((c) =>
                  c.children.length ? (
                    <optgroup key={c.id} label={c.name}>
                      {c.children.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ),
                )}
              </Select>
            </FormField>
            <FormField id="brand" label="Brand (optional)" error={errors.brand?.message}>
              <Input {...form.register("brand")} />
            </FormField>
          </div>
          <FormField id="tags" label="Tags (optional)" hint="Separate with commas. Helps shoppers find you." error={errors.tags?.message}>
            <Input {...form.register("tags")} placeholder="rice, local, ofada" />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Images</CardTitle>
          <CardDescription>Up to 8. The cover image is shown in search and category pages. Alt text is required.</CardDescription>
        </CardHeader>
        <CardContent>
          <ImageGalleryInput
            purpose="product"
            value={images ?? []}
            onChange={(next) => form.setValue("images", next as never, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })}
            error={errors.images?.message ?? (Array.isArray(errors.images) ? "Every image needs alt text (at least 3 characters)." : undefined)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Options and variants</CardTitle>
          <CardDescription>Add options like Size or Colour to sell versions with their own price, stock and SKU.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {options.fields.map((field, i) => (
            <div key={field.id} className="grid items-start gap-3 sm:grid-cols-[180px_1fr_auto]">
              <FormField id={`options.${i}.name`} label="Option" error={errors.options?.[i]?.name?.message}>
                <Input {...form.register(`options.${i}.name`)} placeholder="Size" />
              </FormField>
              <FormField id={`options.${i}.values`} label="Values, separated by commas" error={errors.options?.[i]?.values?.message}>
                <Input {...form.register(`options.${i}.values`)} placeholder="Small, Medium, Large" />
              </FormField>
              <Button type="button" variant="ghost" size="icon" className="sm:mt-7" onClick={() => options.remove(i)} aria-label={`Remove option ${i + 1}`}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          {errors.options?.message && <p className="text-xs font-medium text-danger">{errors.options.message}</p>}
          <div className="flex flex-wrap gap-2">
            {options.fields.length < 3 && (
              <Button type="button" variant="outline" size="sm" onClick={() => options.append({ name: "", values: "" })}>
                <Plus aria-hidden /> Add option
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={regenerateVariants}>
              {options.fields.length ? "Update variants from options" : "Reset variants"}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Variants</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-2">Variant</th>
                  <th scope="col" className="py-2 pr-2">SKU</th>
                  <th scope="col" className="py-2 pr-2">Price (₦)</th>
                  <th scope="col" className="py-2 pr-2">Compare-at (₦)</th>
                  <th scope="col" className="py-2 pr-2">Stock</th>
                  <th scope="col" className="py-2 pr-2">Alert at</th>
                  <th scope="col" className="py-2 pr-2">Barcode</th>
                  {(images?.length ?? 0) > 0 && optionNames.length > 0 && <th scope="col" className="py-2 pr-2">Image</th>}
                </tr>
              </thead>
              <tbody>
                {variants.fields.map((field, i) => {
                  const ve = errors.variants?.[i];
                  const label = Object.values(variantValues?.[i]?.optionValues ?? {}).join(" / ") || "Default";
                  const cell = (name: "sku" | "price" | "compareAtPrice" | "stockQty" | "lowStockThreshold" | "barcode", props: React.ComponentProps<typeof Input> = {}) => (
                    <td className="py-1 pr-2 align-top">
                      <Input
                        aria-label={`${label} ${name}`}
                        aria-invalid={ve?.[name] ? true : undefined}
                        title={ve?.[name]?.message}
                        className="h-9"
                        {...props}
                        {...form.register(`variants.${i}.${name}`)}
                      />
                      {ve?.[name]?.message && <p className="mt-1 text-xs text-danger">{ve[name]?.message}</p>}
                    </td>
                  );
                  return (
                    <tr key={field._key} className="border-t">
                      <th scope="row" className="py-2 pr-2 text-left font-medium">
                        {label}
                        {(ve?.optionValues as { message?: string } | undefined)?.message && (
                          <p className="text-xs font-normal text-danger">{(ve?.optionValues as { message?: string }).message}</p>
                        )}
                      </th>
                      {cell("sku")}
                      {cell("price", { inputMode: "decimal" })}
                      {cell("compareAtPrice", { inputMode: "decimal" })}
                      {cell("stockQty", { inputMode: "decimal" })}
                      {cell("lowStockThreshold", { inputMode: "decimal" })}
                      {cell("barcode")}
                      {(images?.length ?? 0) > 0 && optionNames.length > 0 && (
                        <td className="py-1 pr-2 align-top">
                          <Select aria-label={`${label} image`} className="h-9" {...form.register(`variants.${i}.imageKey`)}>
                            <option value="">Cover</option>
                            {images.map((img, n) => (
                              <option key={img.key} value={img.key}>
                                Image {n + 1}
                              </option>
                            ))}
                          </Select>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {errors.variants?.message && <p className="text-xs font-medium text-danger">{errors.variants.message}</p>}
          <FormField id="costPrice" label="Cost price per item (₦, optional)" hint="Private. Used for your profit reports." error={errors.costPrice?.message}>
            <Input inputMode="decimal" className="max-w-48" {...form.register("costPrice")} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inventory and units</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField id="unit" label="Sold by" error={errors.unit?.message}>
              <Select
                {...form.register("unit", {
                  onChange: (e) => {
                    if (!UNITS.find((u) => u.value === e.target.value)?.fractional) form.setValue("allowFractionalQty", false);
                  },
                })}
              >
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="minOrderQty" label="Minimum order" error={errors.minOrderQty?.message}>
              <Input inputMode="decimal" {...form.register("minOrderQty")} />
            </FormField>
          </div>
          <Checkbox
            id="allowFractionalQty"
            label="Allow fractional quantities"
            hint={fractionalUnit ? "e.g. 1.5 kg. Stock can then be fractional too." : "Only for products sold by kg or litre."}
            disabled={!fractionalUnit}
            {...form.register("allowFractionalQty")}
          />
          {errors.allowFractionalQty && <p className="text-xs font-medium text-danger">{errors.allowFractionalQty.message}</p>}
          <Checkbox id="trackInventory" label="Track stock" hint="Stock goes down with each sale and shoppers can't buy more than you have." {...form.register("trackInventory")} />
          <Checkbox id="allowBackorder" label="Allow orders when out of stock" hint="Only if you can restock quickly." {...form.register("allowBackorder")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delivery details</CardTitle>
          <CardDescription>Used to work out delivery fees at checkout.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-4">
            <FormField id="weightGrams" label="Weight (g)" error={errors.weightGrams?.message}>
              <Input inputMode="numeric" {...form.register("weightGrams", { setValueAs: emptyToUndefined })} />
            </FormField>
            <FormField id="lengthCm" label="Length (cm)" error={errors.lengthCm?.message}>
              <Input inputMode="decimal" {...form.register("lengthCm", { setValueAs: emptyToUndefined })} />
            </FormField>
            <FormField id="widthCm" label="Width (cm)" error={errors.widthCm?.message}>
              <Input inputMode="decimal" {...form.register("widthCm", { setValueAs: emptyToUndefined })} />
            </FormField>
            <FormField id="heightCm" label="Height (cm)" error={errors.heightCm?.message}>
              <Input inputMode="decimal" {...form.register("heightCm", { setValueAs: emptyToUndefined })} />
            </FormField>
          </div>
          <Checkbox id="isPerishable" label="Perishable" hint="Fresh food and anything with a short shelf life." {...form.register("isPerishable")} />
          {isPerishable && (
            <FormField id="shelfLifeNote" label="Shelf life" hint="e.g. Keeps 5 days refrigerated." error={errors.shelfLifeNote?.message}>
              <Input {...form.register("shelfLifeNote")} />
            </FormField>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Search engines</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormField id="slug" label="Web address" hint="Leave blank to create one from the title." error={errors.slug?.message}>
            <Input {...form.register("slug")} placeholder={title ? "auto" : ""} />
          </FormField>
          <FormField id="metaTitle" label="Page title (optional)" error={errors.metaTitle?.message}>
            <Input maxLength={70} {...form.register("metaTitle")} />
          </FormField>
          <FormField id="metaDescription" label="Page description (optional)" error={errors.metaDescription?.message}>
            <Textarea rows={2} maxLength={160} {...form.register("metaDescription")} />
          </FormField>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-3 px-4 py-3">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <div className="w-40">
            <Select id="status" {...form.register("status")}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save product"}
          </Button>
        </div>
      </div>
    </form>
  );
}
