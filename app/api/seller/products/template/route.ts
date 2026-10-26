import { NextResponse } from "next/server";
import { templateCsv } from "@/lib/catalogue/csv";

export function GET() {
  return new NextResponse(`﻿${templateCsv()}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="townmart-products-template.csv"' },
  });
}
