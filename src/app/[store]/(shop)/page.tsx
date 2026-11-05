// The store's home: the hero (its photo, its line, two buttons and what the buyer can count on),
// the best sellers, the categories, and three promises (delivery, payment, help).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { mediaUrl } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/money";
import { categoriesOf, freeFrom } from "@/lib/shop";
import { bestSellerIds, loadShipping, loadShop, loadStore, siteOrigin } from "@/lib/storefront";
import { CashIcon, ChatIcon, CircleCheck, NextIcon, TruckIcon, UpRightIcon } from "../_ui/icons";
import { ProductGrid } from "../_ui/ProductCard";

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

export default async function StoreHome({ params }: Params) {
  const found = await loadStore((await params).store);
  if (!found) notFound();
  const { store, owner } = found;
  const [products, shipping, best] = await Promise.all([loadShop(store.id, owner), loadShipping(store.id), bestSellerIds(store.id)]);
  const base = `/${store.slug}`;
  const visible = products.filter((p) => owner || !p.draft);
  const cats = categoriesOf(visible.filter((p) => !p.draft));
  const free = freeFrom(shipping);
  const money = (n: number) => formatPrice(n, store.currency);

  // Best sellers: the most ordered, then the newest to fill four places.
  const ranked = [...best.map((id) => visible.find((p) => p.id === id)).filter((p) => p != null), ...visible.filter((p) => !best.includes(p.id))];
  const top = ranked.slice(0, 4);
  const badges = new Map(best.slice(0, 2).map((id) => [id, "Meilleure vente"]));
  const heroImage = store.hero_key ? mediaUrl(store.hero_key) : (visible.find((p) => p.cover)?.cover ?? null);
  const firstCat = cats[0];
  const ticks = [
    store.cod_enabled && "Paiement à la livraison",
    free != null ? `Livraison offerte dès ${money(free)}` : "Livraison partout au Maroc",
    store.whatsapp && "Commande confirmée sur WhatsApp",
  ].filter(Boolean) as string[];

  return (
    <>
      <section className="grid items-center gap-10 pt-10 md:grid-cols-2 md:gap-16 md:pt-12">
        <div className="order-2 md:order-1">
          <p className="text-[16px] font-medium text-ink-3">{store.city ? `Boutique à ${store.city}` : "Bienvenue"}</p>
          <h1 className="mt-2 text-[34px] font-extrabold leading-[1.08] tracking-[-0.035em] text-[#16151A] md:text-[40px]">
            {store.tagline ?? store.name}
          </h1>
          <p className="mt-4 max-w-[420px] text-[15px] leading-relaxed text-ink-2">
            {store.tagline ? `${store.name}. ` : ""}Choisissez en ligne, le vendeur vous confirme la commande sur WhatsApp et vous livre.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={`${base}/boutique`} className="ui-btn ui-btn-primary h-12 px-6 text-[16px]">
              Voir les produits
            </Link>
            {firstCat && (
              <Link href={`${base}/c/${firstCat.slug}`} className="ui-btn ui-btn-secondary h-12 px-6 text-[16px] text-ink">
                {firstCat.name}
              </Link>
            )}
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-ink-2">
            {ticks.map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <CircleCheck size={12} className="text-ok" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        {heroImage && (
          <div className="order-1 aspect-[4/5] overflow-hidden rounded-lg bg-[#F3F3F5] md:order-2 md:aspect-[4/5]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroImage}
              alt=""
              className={store.hero_key ? "h-full w-full object-cover" : "h-full w-full object-contain p-[10%] mix-blend-multiply"}
            />
          </div>
        )}
      </section>

      {top.length > 0 ? (
        <section className="mt-20">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[20px] font-extrabold tracking-[-0.03em]">Meilleures ventes</h2>
            <Link href={`${base}/boutique`} className="shop-mini">
              <UpRightIcon size={10} /> Tout voir
            </Link>
          </div>
          <ProductGrid products={top} slug={store.slug} currency={store.currency} badges={badges} />
        </section>
      ) : (
        <p className="mt-20 text-center text-[14px] text-ink-3">Les produits arrivent bientôt.</p>
      )}

      {cats.length > 1 && (
        <section className="mt-20">
          <h2 className="mb-4 text-[20px] font-extrabold tracking-[-0.03em]">Acheter par catégorie</h2>
          <ul className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3">
            {cats.slice(0, 6).map((c) => (
              <li key={c.slug}>
                <Link href={`${base}/c/${c.slug}`} className="group block">
                  <span className="block aspect-square overflow-hidden rounded-lg bg-[#F3F3F5]">
                    {c.cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.cover} alt="" loading="lazy" className="h-full w-full object-contain p-[8%] mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.03]" />
                    )}
                  </span>
                  <span className="mt-3 flex items-center justify-between">
                    <span className="text-[14px] font-semibold">{c.name}</span>
                    <NextIcon size={14} className="text-ink-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="text-[12px] text-ink-3">
                    {c.count} produit{c.count > 1 ? "s" : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-20 grid gap-6 border-y border-line py-8 md:grid-cols-3">
        <Pledge icon={<TruckIcon />} title={free != null ? `Livraison offerte dès ${money(free)}` : "Livraison partout au Maroc"}>
          {shipping[0]
            ? `${shipping[0].name}${shipping[0].delay_days != null ? `, en ${shipping[0].delay_days} jour${shipping[0].delay_days > 1 ? "s" : ""}` : ""}.`
            : "Le vendeur vous propose la livraison la plus simple."}
        </Pledge>
        <Pledge icon={<CashIcon />} title={store.cod_enabled ? "Payez à la livraison" : "Paiement simple"}>
          {store.cod_enabled ? "En espèces, quand vous recevez votre commande." : "Le vendeur vous indique comment payer."}
        </Pledge>
        <Pledge icon={<ChatIcon />} title="Une question ?">
          {store.whatsapp ? (
            <a href={`https://wa.me/${store.whatsapp}`} target="_blank" rel="noopener" className="underline underline-offset-2">
              Écrivez-nous sur WhatsApp
            </a>
          ) : (
            "Le vendeur vous répond après votre commande."
          )}
        </Pledge>
      </section>
    </>
  );
}

function Pledge({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-ink-2">{icon}</span>
      <div>
        <p className="text-[14px] font-bold">{title}</p>
        <p className="mt-0.5 text-[13px] text-ink-3">{children}</p>
      </div>
    </div>
  );
}
