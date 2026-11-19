"use client";

import { Bike, Navigation, UserX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { assignRiderAction } from "@/lib/fulfilment/rider-actions";
import { cn } from "@/lib/utils";

export type RiderOption = {
  id: string;
  name: string;
  vehicle: string;
  /** "800 m from the shop", "At the shop", … */
  where: string;
  available: boolean;
  busy: string | null;
  suggested: boolean;
};

/** Shows the order's rider, and the shop's riders nearest the shop first, to assign with one tap. */
export function RiderPicker({
  sellerOrderId,
  current,
  options,
  canManage,
  dropOffUrl,
}: {
  sellerOrderId: string;
  current: { id: string; name: string; assigned: string; pickedUp: string | null; jobUrl?: string | null } | null;
  options: RiderOption[];
  canManage: boolean;
  dropOffUrl: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(current === null);

  const assign = (riderId: string | null) =>
    start(async () => {
      const res = await assignRiderAction({ sellerOrderId, riderId });
      if (res.ok) {
        setError(null);
        setChanging(riderId === null);
        router.refresh();
      } else setError(res.error ?? "Something went wrong.");
    });

  return (
    <div className="flex flex-col gap-3 text-sm">
      {current && (
        <div className="flex flex-col gap-1 rounded-xl border border-primary bg-primary-soft p-3">
          <p className="flex items-center gap-2 font-medium">
            <Bike className="size-4" aria-hidden /> {current.name}
          </p>
          <p className="text-muted-foreground">
            Assigned {current.assigned}
            {current.pickedUp && ` · picked up ${current.pickedUp}`}
          </p>
          {current.jobUrl && (
            <p className="text-muted-foreground">
              We texted {current.name} their job link. Didn&apos;t get it?{" "}
              <a href={`https://wa.me/?text=${encodeURIComponent(`Your TownMart delivery job: ${current.jobUrl}`)}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                Send it on WhatsApp
              </a>
            </p>
          )}
          {canManage && !changing && (
            <div className="mt-1 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setChanging(true)}>
                Change rider
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => assign(null)}>
                <UserX aria-hidden /> Remove
              </Button>
            </div>
          )}
        </div>
      )}
      {dropOffUrl && (
        <a href={dropOffUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary underline">
          <Navigation className="size-4" aria-hidden /> Directions to the customer
        </a>
      )}
      {canManage && changing && (
        <>
          {options.length === 0 ? (
            <p className="text-muted-foreground">
              You haven&apos;t added any riders yet.{" "}
              <Link href="/dashboard/riders" className="text-primary underline">
                Add your riders
              </Link>{" "}
              to assign them to deliveries.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {options
                .filter((o) => o.id !== current?.id)
                .map((o) => (
                  <li key={o.id} className={cn("flex items-center gap-3 rounded-xl border p-3", !o.available && "opacity-60")}>
                    <div className="flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {o.name}
                        {o.suggested && <Badge variant="success">Nearest free</Badge>}
                        {!o.available && <Badge variant="secondary">Off duty</Badge>}
                      </p>
                      <p className="text-muted-foreground">
                        {o.vehicle} · {o.where}
                        {o.busy && ` · ${o.busy}`}
                      </p>
                    </div>
                    <Button type="button" size="sm" variant={o.suggested ? "default" : "outline"} disabled={pending} onClick={() => assign(o.id)}>
                      Assign
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
      {error && <Alert variant="danger">{error}</Alert>}
    </div>
  );
}
