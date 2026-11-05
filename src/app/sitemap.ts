// /sitemap.xml: every published store and its published products, for search engines. Read by
// the server (published rows only), so a signed-in merchant's drafts never get in.

import type { MetadataRoute } from "next";
import { withDb } from "@/lib/server/db";
import { siteOrigin } from "@/lib/storefront";

type Row = { slug: string; store_at: Date; product_id: string | null; product_at: Date | null };

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin(); // a request-time read: the sitemap is built per request
  let rows: Row[] = [];
  try {
    rows = await withDb(
      (sql) => sql<Row[]>`
        select s.slug, s.created_at as store_at, p.id as product_id, p.created_at as product_at
        from public.stores s
        left join public.products p on p.store_id = s.id and p.status = 'published'
        where s.published
        order by s.created_at, p.created_at desc`,
    );
  } catch (err) {
    console.error("sitemap read failed", err);
  }

  const out: MetadataRoute.Sitemap = [{ url: origin, changeFrequency: "weekly", priority: 0.5 }];
  const stores = new Map<string, Date>();
  for (const r of rows) {
    const last = stores.get(r.slug) ?? r.store_at; // a store changes when a product is added
    stores.set(r.slug, r.product_at && r.product_at > last ? r.product_at : last);
  }
  for (const [slug, at] of stores) out.push({ url: `${origin}/${slug}`, lastModified: at, changeFrequency: "daily", priority: 1 });
  for (const r of rows) {
    if (r.product_id) out.push({ url: `${origin}/${r.slug}/${r.product_id}`, lastModified: r.product_at ?? undefined, changeFrequency: "weekly", priority: 0.8 });
  }
  return out;
}
