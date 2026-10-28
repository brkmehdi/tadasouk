// The store's banner, made by muse-image-1.0 when the merchant asks for it (docs/image-generation):
// a wide photo of a shop like theirs, built from its name, city and products, with no text, logo
// or face. Stored in R2 like an uploaded banner and charged to the merchant's AI credit.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { withDb } from "@/lib/server/db";
import { aiContext, errorResponse, metaFetch } from "@/lib/server/meta";
import { PRICES, reserve, settle } from "@/lib/server/usage";

export async function POST() {
  try {
    const ctx = await aiContext();
    const shop = await withDb(async (sql) => {
      const [s] = await sql<{ id: string; name: string; city: string | null }[]>`
        select id, name, city from public.stores where owner_id = ${ctx.userId}::uuid`;
      if (!s) return null;
      const products = await sql<{ name: string }[]>`
        select name from public.products where store_id = ${s.id} and name <> '' order by created_at desc limit 8`;
      return { ...s, products: products.map((p) => p.name) };
    });
    if (!shop) return NextResponse.json({ error: "no_store" }, { status: 403 });

    const sells = shop.products.length ? ` It sells: ${shop.products.join(", ")}.` : "";
    const prompt =
      `A wide, photographic banner for a small shop in Morocco called "${shop.name}"${shop.city ? ` in ${shop.city}` : ""}.${sells} ` +
      `Show products like these, nicely arranged in a warm, real shop setting, natural light, shallow depth of field, ` +
      `inviting and clean. No text, no letters, no logos, no people's faces.`;

    const cost = PRICES["muse-image-1.0"].image;
    const r = await reserve(ctx, "store-hero", "muse-image-1.0", "/images/generations hero", cost);
    let bytes: Uint8Array;
    try {
      const res = await metaFetch("/images/generations", {
        method: "POST",
        accept: "application/json",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "muse-image-1.0", prompt, n: 1, size: "1792x1024", output_format: "jpeg" }),
      });
      const data = (await res.json()) as { data?: { b64_json?: string }[] };
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new Error("no image in the answer");
      bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    } catch (err) {
      await settle(r, 0, false);
      throw err;
    }
    await settle(r, cost, true, { images: 1 });

    const key = `stores/${shop.id}/hero/${crypto.randomUUID()}.jpg`;
    await getCloudflareContext().env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
    });
    await withDb((sql) => sql`update public.stores set hero_key = ${key} where id = ${shop.id}`);
    return NextResponse.json({ key });
  } catch (err) {
    return errorResponse(err);
  }
}
