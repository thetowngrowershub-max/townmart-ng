"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteProductAction, deleteServiceAction } from "@/lib/catalogue/actions";

export function DeleteListingButton({ kind, id }: { kind: "product" | "service"; id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Delete this ${kind}? Shoppers won't see it any more. This can't be undone from the dashboard.`)) return;
        start(async () => {
          const res = kind === "product" ? await deleteProductAction(id) : await deleteServiceAction(id);
          if (res.ok) router.push(kind === "product" ? "/dashboard/products" : "/dashboard/services");
          else window.alert(res.error);
        });
      }}
    >
      <Trash2 aria-hidden /> Delete
    </Button>
  );
}
