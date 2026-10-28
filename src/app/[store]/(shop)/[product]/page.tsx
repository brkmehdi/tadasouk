// One product (the view is ProductView: gallery, colours, sizes, add to cart). The page carries
// Open Graph tags (WhatsApp shows the photo, name, price and a line of description in the chat)
// and schema.org Product data (name, image, price, availability) for search engines.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { mediaUrl, photosOf } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/money";
import { loadProduct, loadStore, siteOrigin, toShopProduct } from "@/lib/storefront";
import { ProductView } from "../../_ui/ProductView";

type Params = { params: Promise<{ store: string; product: string }> };

async function load(params: Params["params"]) {
  const { store: slug, product: id } = await params;
  const found = await loadStore(slug);
  if (!found) return null;
  const product = await loadProduct(found.store.id, id);
  return product ? { ...found, product } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await load(params);
  if (!found) return {};
  const { store, product: p } = found;
  const origin = await siteOrigin();
  const price = p.price != null ? formatPrice(p.price, store.currency) : null;
  const title = price ? `${p.name} · ${price}` : p.name;
  const description = (p.description ?? `${p.name}, chez ${store.name}.`).slice(0, 180);
  const cover = photosOf(p)[0];
  return {
    title: `${title} · ${store.name}`,
    description,
    openGraph: {
      type: "website",
      title,
      description,
      url: `${origin}/${store.slug}/${p.id}`,
      siteName: store.name,
      images: cover ? [{ url: `${origin}${mediaUrl(cover.r2_key)}`, alt: p.name }] : undefined,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ProductPage({ params }: Params) {
  const found = await load(params);
  if (!found) notFound();
  const { store, product: p } = found;
  const origin = await siteOrigin();
  const photos = photosOf(p);
  const url = `${origin}/${store.slug}/${p.id}`;
  const inStock = p.stock == null || p.stock > 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description ?? undefined,
    image: photos.map((i) => `${origin}${mediaUrl(i.r2_key)}`),
    sku: p.id,
    gtin: p.barcode ?? undefined,
    brand: { "@type": "Brand", name: store.name },
    offers:
      p.price != null
        ? {
            "@type": "Offer",
            url,
            price: p.price,
            priceCurrency: store.currency,
            availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            seller: { "@type": "Organization", name: store.name },
          }
        : undefined,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <ProductView
        product={toShopProduct(p)}
        photos={photos.map((i) => ({ url: mediaUrl(i.r2_key), colorId: i.color_id }))}
        shareUrl={url}
      />
    </>
  );
}
