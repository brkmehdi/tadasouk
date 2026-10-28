// The store's foot: its categories, help (delivery, payment, WhatsApp) and where it is.

import Link from "next/link";
import { categoriesOf, type ShopProduct } from "@/lib/shop";
import type { ShopStore } from "./cart";

export function Footer({ store, products }: { store: ShopStore; products: ShopProduct[] }) {
  const cats = categoriesOf(products.filter((p) => !p.draft)).slice(0, 6);
  const base = `/${store.slug}`;
  const col = "flex flex-col gap-2.5 text-[14px] text-ink-2";
  return (
    <footer className="mt-24 border-t border-black/10">
      <div className="mx-auto grid max-w-[952px] grid-cols-2 gap-8 px-4 py-12 md:grid-cols-4">
        <div className={col}>
          <p className="mb-1 text-[14px] font-medium text-ink">Boutique</p>
          <Link href={`${base}/boutique`} className="hover:text-ink">
            Tout voir
          </Link>
          {cats.map((c) => (
            <Link key={c.slug} href={`${base}/c/${c.slug}`} className="hover:text-ink">
              {c.name}
            </Link>
          ))}
        </div>
        <div className={col}>
          <p className="mb-1 text-[14px] font-medium text-ink">Aide</p>
          <Link href={`${base}/panier`} className="hover:text-ink">
            Livraison
          </Link>
          {store.cod && <span>Paiement à la livraison</span>}
          {store.whatsapp && (
            <a href={`https://wa.me/${store.whatsapp}`} target="_blank" rel="noopener" className="hover:text-ink">
              Nous écrire sur WhatsApp
            </a>
          )}
        </div>
        <div className={`${col} col-span-2`}>
          <p className="mb-1 text-[14px] font-medium text-ink">{store.name}</p>
          <span>{store.city ? `Boutique à ${store.city}, Maroc.` : "Boutique au Maroc."}</span>
          <span>Commandez en ligne, le vendeur vous confirme la livraison sur WhatsApp.</span>
        </div>
      </div>
      <div className="mx-auto flex max-w-[952px] flex-wrap justify-between gap-2 px-4 pb-10 text-[12px] text-ink-3">
        <span>
          © {new Date().getFullYear()} {store.name}
          {store.city ? `, ${store.city}` : ""}
        </span>
        <Link href="/" className="hover:text-ink-2">
          Boutique créée avec SmallStore
        </Link>
      </div>
    </footer>
  );
}
