import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { storage } from "./index";
import { LocalStorageProvider } from "./local";
import type { BucketName } from "./provider";

/** Shared guard for the app/api/storage/* routes, which exist only for the local driver. */
export function localProvider(): LocalStorageProvider | NextResponse {
  if (env().STORAGE_DRIVER !== "local") return new NextResponse(null, { status: 404 });
  return storage() as LocalStorageProvider;
}

export function parseBucket(value: string | null): BucketName | null {
  return value === "public" || value === "private" ? value : null;
}

export const notAllowed = () => new NextResponse("Forbidden", { status: 403 });
