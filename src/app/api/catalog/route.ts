// A barcode read by the camera -> the product in the shared catalog, before any AI is asked.

import { NextResponse } from "next/server";
import { NotSignedInError, requireUser } from "@/lib/server/auth";
import { findByBarcode } from "@/lib/server/catalog";

export async function GET(req: Request) {
  try {
    await requireUser();
    const product = await findByBarcode(new URL(req.url).searchParams.get("barcode"));
    return NextResponse.json({ product });
  } catch (err) {
    if (err instanceof NotSignedInError) return NextResponse.json({ error: "signed_out" }, { status: 401 });
    console.error("catalog lookup failed", err);
    return NextResponse.json({ product: null });
  }
}
