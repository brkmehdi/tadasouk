// One product: its photos, price, description, add to basket, share on WhatsApp. The page carries
// Open Graph tags (WhatsApp shows the photo, name, price and a line of description in the chat)
// and schema.org Product data (name, image, price, availability) for search engines.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { mediaUrl, photosOf } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/money";
import { loadProduct, loadStore, siteOrigin } from "@/lib/storefront";
import { AddToCart, ShareOnWhatsApp } from "../Cart";

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
  const price = p.price != null ? formatPrice(p.price, store.currency) : null;
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
    <main className="mx-auto max-w-5xl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav className="px-5 pt-4 pb-2 text-sm">
        <Link href={`/${store.slug}`} className="font-medium text-brand">
          ← {store.name}
        </Link>
      </nav>

      <div className="sm:grid sm:grid-cols-2 sm:gap-8 sm:px-5">
        <div className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto sm:rounded-lg sm:ring-1 sm:ring-line">
          {photos.length ? (
            photos.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={img.id} src={mediaUrl(img.r2_key)} alt={p.name} className="aspect-square w-full shrink-0 snap-center bg-white object-contain" />
            ))
          ) : (
            <div className="aspect-square w-full bg-soft" />
          )}
        </div>
        {photos.length > 1 && <p className="mt-2 text-center text-xs text-ink-3 sm:hidden">{photos.length} photos, glissez pour les voir</p>}

        <section className="px-5 pt-5 sm:px-0">
          {p.status !== "published" && (
            <p className="mb-3 inline-block rounded bg-ink/80 px-2 py-0.5 text-xs font-medium text-white">Brouillon : visible par vous seulement</p>
          )}
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{p.name || "Produit"}</h1>
          <p className="mt-2 flex items-baseline gap-2 text-2xl font-semibold tabular-nums">
            {price ?? "Prix sur demande"}
            {p.compare_at_price != null && p.price != null && p.compare_at_price > p.price && (
              <span className="text-base font-normal text-ink-3 line-through">{formatPrice(p.compare_at_price, store.currency)}</span>
            )}
          </p>
          {!inStock && <p className="mt-1 text-sm text-danger">Épuisé pour le moment</p>}
          {p.description && <p className="mt-4 text-[15px] leading-relaxed text-ink-2">{p.description}</p>}

          <div className="mt-6 flex flex-col gap-3">
            {inStock && <AddToCart product={{ id: p.id, name: p.name, price: p.price, image: photos[0] ? mediaUrl(photos[0].r2_key) : null }} />}
            <ShareOnWhatsApp text={price ? `${p.name} · ${price}` : p.name} url={url} className="w-full" />
          </div>
        </section>
      </div>
    </main>
  );
}
