import * as React from "react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, label, hint, id, ...props }: Omit<React.ComponentProps<"input">, "type"> & { label: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className={cn("mt-0.5 size-5 shrink-0 rounded-md border border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      <div className="text-sm">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
