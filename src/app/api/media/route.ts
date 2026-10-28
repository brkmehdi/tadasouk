// Product photos to R2. The browser sends the image bytes of one photo; it lands in the folder of
// the signed-in merchant's own store, stores/{store}/{product}/{image}.{ext}, and /media/... serves
// it. The names are random ids, so a photo is only found through its product.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { NotSignedInError, requireUser } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const product = url.searchParams.get("product") ?? "";
    const image = url.searchParams.get("image") ?? "";
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = TYPES[type];
    if (!UUID.test(product) || !UUID.test(image) || !ext) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const body = await req.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "too_large" }, { status: 413 });
    }
    const storeId = await withDb(async (sql) => {
      const [row] = await sql<{ id: string }[]>`select id from public.stores where owner_id = ${user.id}`;
      return row?.id ?? null;
    });
    if (!storeId) return NextResponse.json({ error: "no_store" }, { status: 403 });

    const key = `stores/${storeId}/${product.toLowerCase()}/${image.toLowerCase()}.${ext}`;
    await getCloudflareContext().env.MEDIA.put(key, body, {
      httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" },
    });
    return NextResponse.json({ key });
  } catch (err) {
    if (err instanceof NotSignedInError) return NextResponse.json({ error: "signed_out" }, { status: 401 });
    console.error("media upload failed", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
