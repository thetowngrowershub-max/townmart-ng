"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useWatch } from "react-hook-form";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatPrice, parseNairaToKobo } from "@/lib/money";
import { unitDiscount } from "@/lib/pricing";
import { savePlatformPromotionAction } from "@/lib/admin/promotion-actions";
import { savePromotionAction } from "@/lib/promotions/actions";
import { FLASH_DEAL_MAX_HOURS, promotionInputSchema, type PromotionInput } from "@/lib/validation/promotions";

export type PickOption = { id: string; label: string; detail?: string };

const SCOPE_LABELS: Record<PromotionInput["scope"], string> = {
  store: "Everything in my store",
  product: "One product",
  products: "Selected products",
  category: "A category",
  service: "Selected services",
};

function TargetPicker({
  name,
  legend,
  options,
  value,
  onChange,
  error,
  single,
}: {
  name: string;
  legend: string;
  options: PickOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string;
  single?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? options.filter((o) => o.label.toLowerCase().includes(f)) : options;
  }, [filter, options]);
  const selected = new Set(value);

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="mb-1 text-sm font-medium">
        {legend} <span className="font-normal text-muted-foreground">({value.length} chosen)</span>
      </legend>
      {options.length > 8 && (
        <Input id={`${name}-filter`} type="search" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={`Filter ${legend.toLowerCase()}`} />
      )}
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to choose yet.</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-xl border p-2">
          {shown.map((o) => (
            <li key={o.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                <input
                  type={single ? "radio" : "checkbox"}
                  name={name}
                  className="size-4 accent-primary"
                  checked={selected.has(o.id)}
                  onChange={(e) => onChange(single ? [o.id] : e.target.checked ? [...value, o.id] : value.filter((id) => id !== o.id))}
                />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.detail && <span className="shrink-0 text-xs text-muted-foreground">{o.detail}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={`${name}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function PromotionForm({
  promotionId,
  initial,
  products,
  services,
  categories,
  redemptionCount,
  platform = false,
}: {
  promotionId: string | null;
  initial: PromotionInput;
  products: PickOption[];
  services: PickOption[];
  categories: PickOption[];
  redemptionCount: number;
  /** TownMart's own promotion, edited from the admin console: everything or whole categories only. */
  platform?: boolean;
}) {
  const router = useRouter();
  const { form, onSubmit, pending, result } = useActionForm(
    promotionInputSchema,
    async (values) => {
      const res = await (platform ? savePlatformPromotionAction : savePromotionAction)(promotionId, values);
      if (res.ok && res.data) {
        if (!promotionId) router.push(`${platform ? "/admin/catalogue/promotions" : "/dashboard/promotions"}/${res.data.id}?saved=1`);
        else router.refresh();
      }
      return res;
    },
    initial,
  );
  const errors = form.formState.errors;
  const [discountType, discountValue, scope, isFlashDeal, couponCode, productIds, serviceIds, categoryIds] = useWatch({
    control: form.control,
    name: ["discountType", "discountValue", "scope", "isFlashDeal", "couponCode", "productIds", "serviceIds", "categoryIds"],
  });

  // A worked example so the seller sees exactly what shoppers will pay.
  const example = useMemo(() => {
    try {
      const value = discountType === "percentage" ? BigInt(Math.trunc(Number(discountValue))) : parseNairaToKobo(discountValue);
      if (value <= 0n) return null;
      const price = 1_000_000n;
      const off = unitDiscount({ discountType, discountValue: value }, price);
      return `An item priced ${formatPrice(price)} sells for ${formatPrice(price - off)}.`;
    } catch {
      return null;
    }
  }, [discountType, discountValue]);

  const setIds = (field: "productIds" | "serviceIds" | "categoryIds") => (ids: string[]) =>
    form.setValue(field, ids, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6 pb-24">
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      {result?.ok && <Alert variant="success">{result.message}</Alert>}
      {redemptionCount > 0 && (
        <Alert variant="info">
          Customers have used this promotion {redemptionCount} time{redemptionCount === 1 ? "" : "s"}. Changes apply to new orders only.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Discount</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormField id="name" label="Name" hint="Shoppers see this, e.g. “Weekend rice sale”." error={errors.name?.message}>
            <Input maxLength={80} {...form.register("name")} />
          </FormField>
          <FormField id="description" label="Details (optional)" error={errors.description?.message}>
            <Textarea rows={2} maxLength={300} {...form.register("description")} />
          </FormField>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField id="discountType" label="Type" error={errors.discountType?.message}>
              <Select {...form.register("discountType")}>
                <option value="percentage">Percentage off</option>
                <option value="fixed">Naira amount off each item</option>
              </Select>
            </FormField>
            <FormField
              id="discountValue"
              label={discountType === "percentage" ? "Percentage (%)" : "Amount off each item (₦)"}
              error={errors.discountValue?.message}
            >
              <Input inputMode={discountType === "percentage" ? "numeric" : "decimal"} {...form.register("discountValue")} />
            </FormField>
          </div>
          {example && <p className="text-sm text-muted-foreground">{example} Prices never go below ₦0.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Applies to</CardTitle>
          <CardDescription>Shoppers get the single best discount on each item. A coupon can stack only if you allow it below.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormField id="scope" label="What's on promotion" error={errors.scope?.message}>
            <Select {...form.register("scope")}>
              {(platform ? (["store", "category"] as const) : (Object.keys(SCOPE_LABELS) as PromotionInput["scope"][])).map((s) => (
                <option key={s} value={s} disabled={s === "service" && services.length === 0}>
                  {platform && s === "store" ? "Everything on TownMart" : SCOPE_LABELS[s]}
                </option>
              ))}
            </Select>
          </FormField>
          {(scope === "product" || scope === "products") && (
            <TargetPicker
              name="productIds"
              legend={scope === "product" ? "Product" : "Products"}
              options={products}
              value={productIds ?? []}
              onChange={setIds("productIds")}
              error={errors.productIds?.message ?? errors.productIds?.root?.message}
              single={scope === "product"}
            />
          )}
          {scope === "service" && (
            <TargetPicker name="serviceIds" legend="Services" options={services} value={serviceIds ?? []} onChange={setIds("serviceIds")} error={errors.serviceIds?.message} />
          )}
          {scope === "category" && (
            <TargetPicker
              name="categoryIds"
              legend="Categories"
              options={categories}
              value={categoryIds ?? []}
              onChange={setIds("categoryIds")}
              error={errors.categoryIds?.message}
            />
          )}
          {scope === "category" && <p className="text-sm text-muted-foreground">{platform ? "Every seller's listings in these categories get the discount. TownMart pays for it." : "Only your own listings in these categories get the discount."}</p>}
          {platform && scope === "store" && <p className="text-sm text-muted-foreground">Every listing on TownMart gets the discount. TownMart pays for it, not sellers.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>When</CardTitle>
          <CardDescription>Times are Lagos time. Listings show the real end date; TownMart never shows a fake countdown.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField id="startsAt" label="Starts" error={errors.startsAt?.message}>
              <Input type="datetime-local" {...form.register("startsAt")} />
            </FormField>
            <FormField id="endsAt" label="Ends" error={errors.endsAt?.message}>
              <Input type="datetime-local" {...form.register("endsAt")} />
            </FormField>
          </div>
          <Checkbox
            id="isFlashDeal"
            label="Flash deal"
            hint={`Shown in Flash deals on the home page, with its end time. Up to ${FLASH_DEAL_MAX_HOURS} hours.`}
            {...form.register("isFlashDeal")}
          />
          {isFlashDeal && couponCode && <p className="text-sm text-warning-foreground dark:text-warning">Flash deals with a coupon code only show to shoppers who have the code.</p>}
          <Checkbox id="isActive" label="Active" hint="Untick to pause the promotion without changing its dates." {...form.register("isActive")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Limits and coupon</CardTitle>
          <CardDescription>All optional. Leave a limit empty for no limit.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <FormField id="usageLimit" label="Total uses" hint="Orders, across all customers" error={errors.usageLimit?.message}>
              <Input inputMode="numeric" {...form.register("usageLimit")} />
            </FormField>
            <FormField id="perCustomerLimit" label="Uses per customer" error={errors.perCustomerLimit?.message}>
              <Input inputMode="numeric" {...form.register("perCustomerLimit")} />
            </FormField>
            <FormField id="minOrder" label="Minimum order (₦)" hint="Your items in the cart, before discounts" error={errors.minOrder?.message}>
              <Input inputMode="decimal" {...form.register("minOrder")} />
            </FormField>
          </div>
          <FormField
            id="couponCode"
            label="Coupon code"
            hint="With a code, the discount applies only when a shopper enters it at checkout. Without one, it applies automatically."
            error={errors.couponCode?.message}
          >
            <Input className="max-w-60 uppercase" autoComplete="off" maxLength={24} {...form.register("couponCode")} />
          </FormField>
          {couponCode && (
            <Checkbox
              id="allowsStacking"
              label="Can be combined with other promotions"
              hint="The code's discount is taken off the already-discounted price."
              {...form.register("allowsStacking")}
            />
          )}
          {errors.allowsStacking?.message && <p className="text-sm text-danger">{errors.allowsStacking.message}</p>}
          {!couponCode && <p className="text-sm text-muted-foreground">Promotions with a minimum order apply in the cart, so listings don&apos;t show them as a price cut.</p>}
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save promotion"}
          </Button>
        </div>
      </div>
    </form>
  );
}
