// /{slug}/feed.xml: the product feed marketplaces read (RSS 2.0 with the g: namespace, the
// format of Google Merchant Center and Meta Commerce catalogues). Marketplaces never see the
// whole stock: they see it minus the store's safety margin (stores.marketplace_margin), so a
// miscount in the shop never sells a product twice. A product without a stock count is shown
// in stock with no quantity; one without a price is left out (both catalogues require one).

import { mediaUrl, photosOf } from "@/lib/catalog/types";
import { withDb } from "@/lib/server/db";
import { loadProducts, loadStore, siteOrigin } from "@/lib/storefront";
import { marketplaceQty, xmlEscape as x } from "@/lib/visibility";

export async function GET(_req: Request, { params }: { params: Promise<{ store: string }> }) {
  const found = await loadStore((await params).store);
  if (!found?.store.published) return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const { store } = found;
  // The margin is the merchant's setting, not public data: read by the server for this store only.
  const [products, origin, margin] = await Promise.all([
    loadProducts(store.id, false),
    siteOrigin(),
    withDb((sql) => sql<{ m: number }[]>`select marketplace_margin as m from public.stores where id = ${store.id}::uuid`)
      .then((r) => r[0]?.m ?? 20)
      .catch(() => 20),
  ]);
  const home = `${origin}/${store.slug}`;

  const items = products
    .filter((p) => p.price != null && p.price > 0)
    .map((p) => {
      const qty = p.stock == null ? null : marketplaceQty(p.stock, margin);
      const photos = photosOf(p).map((i) => `${origin}${mediaUrl(i.r2_key)}`);
      const sale = p.compare_at_price != null && p.compare_at_price > p.price!;
      const tags = [
        `<g:id>${p.id}</g:id>`,
        `<g:title>${x((p.name || "Produit").slice(0, 150))}</g:title>`,
        `<g:description>${x((p.description || p.name || "Produit").slice(0, 5000))}</g:description>`,
        `<g:link>${home}/${p.id}</g:link>`,
        photos[0] ? `<g:image_link>${x(photos[0])}</g:image_link>` : null,
        ...photos.slice(1, 10).map((u) => `<g:additional_image_link>${x(u)}</g:additional_image_link>`),
        `<g:price>${(sale ? p.compare_at_price! : p.price!).toFixed(2)} ${store.currency}</g:price>`,
        sale ? `<g:sale_price>${p.price!.toFixed(2)} ${store.currency}</g:sale_price>` : null,
        `<g:availability>${qty === 0 ? "out of stock" : "in stock"}</g:availability>`,
        qty != null ? `<g:inventory>${qty}</g:inventory>` : null,
        `<g:condition>new</g:condition>`,
        `<g:brand>${x(store.name)}</g:brand>`,
        p.barcode ? `<g:gtin>${x(p.barcode)}</g:gtin>` : `<g:identifier_exists>no</g:identifier_exists>`,
        p.category?.trim() ? `<g:product_type>${x(p.category.trim())}</g:product_type>` : null,
      ];
      return `    <item>\n${tags
        .filter(Boolean)
        .map((t) => `      ${t}`)
        .join("\n")}\n    </item>`;
    });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${x(store.name)}</title>
    <link>${home}</link>
    <description>${x(store.tagline || `${store.name} : les produits de la boutique`)}</description>
${items.join("\n")}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
