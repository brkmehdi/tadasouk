// The store's home: its hero photo (or just its name), one line about it, and its products.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { coverOf, mediaUrl } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/money";
import { loadProducts, loadStore, siteOrigin } from "@/lib/storefront";

type Params = { params: Promise<{ store: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await loadStore((await params).store);
  if (!found) return {};
  const { store } = found;
  const origin = await siteOrigin();
  const description = store.tagline ?? `La boutique ${store.name}${store.city ? ` à ${store.city}` : ""}. Commandez en ligne, payez à la livraison.`;
  return {
    title: store.name,
    description,
    openGraph: {
      title: store.name,
      description,
      url: `${origin}/${store.slug}`,
      siteName: store.name,
      images: store.hero_key ? [{ url: `${origin}${mediaUrl(store.hero_key)}` }] : undefined,
    },
  };
}

export default async function StorePage({ params }: Params) {
  const found = await loadStore((await params).store);
  if (!found) notFound();
  const { store, owner } = found;
  const products = await loadProducts(store.id, owner);

  return (
    <>
      {store.hero_key ? (
        <header className="relative h-56 overflow-hidden bg-ink sm:h-72">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl(store.hero_key)} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-5xl px-5 pb-5 text-white">
            <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{store.name}</h1>
            {store.tagline && <p className="mt-1 text-sm text-white/85">{store.tagline}</p>}
          </div>
        </header>
      ) : (
        <header className="mx-auto max-w-5xl px-5 pt-10 pb-4">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{store.name}</h1>
          {store.tagline && <p className="mt-1 text-sm text-ink-3">{store.tagline}</p>}
          {!store.tagline && store.city && <p className="mt-1 text-sm text-ink-3">{store.city}</p>}
        </header>
      )}

      <main className="mx-auto max-w-5xl px-5 pt-5">
        {products.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-3">Les produits arrivent bientôt.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => {
              const cover = coverOf(p);
              return (
                <li key={p.id}>
                  <Link href={`/${store.slug}/${p.id}`} className="block">
                    <span className="relative block aspect-square overflow-hidden rounded-lg bg-white ring-1 ring-line">
                      {cover && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover} alt={p.name} className="h-full w-full object-contain" loading="lazy" />
                      )}
                      {p.status !== "published" && (
                        <span className="absolute start-2 top-2 rounded bg-ink/80 px-1.5 py-0.5 text-[11px] font-medium text-white">Brouillon</span>
                      )}
                    </span>
                    <span className="mt-2 line-clamp-2 block text-sm">{p.name || "Produit"}</span>
                    <span className="mt-0.5 flex items-baseline gap-1.5 text-sm font-semibold tabular-nums">
                      {p.price != null ? formatPrice(p.price, store.currency) : "Prix sur demande"}
                      {p.compare_at_price != null && p.price != null && p.compare_at_price > p.price && (
                        <span className="text-xs font-normal text-ink-3 line-through">{formatPrice(p.compare_at_price, store.currency)}</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {store.whatsapp && (
          <p className="mt-12 text-center text-sm text-ink-3">
            Une question ?{" "}
            <a href={`https://wa.me/${store.whatsapp}`} target="_blank" rel="noopener" className="font-medium text-brand">
              Écrivez-nous sur WhatsApp
            </a>
          </p>
        )}
      </main>
    </>
  );
}
