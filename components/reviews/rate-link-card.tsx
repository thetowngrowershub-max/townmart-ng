"use client";

import { Check, Copy, MessageCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** The provider's "Rate my service" link, to copy or send on WhatsApp after a job. */
export function RateLinkCard({ url, businessName }: { url: string; businessName: string }) {
  const [copied, setCopied] = useState(false);
  const message = `Thank you for choosing ${businessName}! Please rate my service on TownMart: ${url}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Your “Rate my service” link</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Send this to customers after you finish a job. Anyone who booked you on TownMart can rate you from it, and good ratings move you up in search.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input readOnly value={url} aria-label="Rate my service link" className="h-9 min-w-0 flex-1 basis-64" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy link"}
          </Button>
          <Button asChild size="sm">
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
              <MessageCircle aria-hidden /> Share on WhatsApp
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
