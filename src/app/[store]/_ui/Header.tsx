"use client";

// The store's top: a thin banner (free delivery from X, or cash on delivery), the store's name,
// its categories, search and the cart button. On a phone the categories fold into a menu.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { formatPrice } from "@/lib/money";
import { categoriesOf, freeFrom } from "@/lib/shop";
import { useCart } from "./cart";
import { BagIcon, CloseIcon, MenuIcon, SearchIcon } from "./icons";

export function Header() {
  const { store, products, shipping, count, openDrawer } = useCart();
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const cats = useMemo(() => categoriesOf(products.filter((p) => !p.draft)), [products]);
  const free = freeFrom(shipping);
  const base = `/${store.slug}`;
  const shown = cats.slice(0, 4);
  const link = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      onClick={() => setMenu(false)}
      className={`text-[15px] font-medium transition-colors ${path === href ? "text-ink" : "text-ink-2 hover:text-ink"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <p className="border-b border-black/10 px-4 py-2 text-center text-[12px] text-ink-2">
        {free != null ? (
          <>
            Livraison offerte dès <b className="font-semibold text-ink">{formatPrice(free, store.currency)}</b>.{" "}
          </>
        ) : null}
        {store.cod ? "Paiement à la livraison." : "Commande confirmée sur WhatsApp."}
      </p>
      <header className="sticky top-0 z-40 border-b border-black/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[60px] max-w-[952px] items-center gap-6 px-4 md:h-[64px]">
          <button type="button" onClick={() => setMenu(true)} aria-label="Menu" className="-ms-1 p-1 md:hidden">
            <MenuIcon size={20} />
          </button>
          <Link href={base} className="max-w-[45vw] truncate text-[20px] font-bold tracking-[-0.03em] text-[#1a1a1a] md:max-w-[220px]">
            {store.name}
            <span className="text-brand">.</span>
          </Link>
          <nav className="hidden items-center gap-6 md:flex" aria-label="Catégories">
            {link(`${base}/boutique`, "Tout voir")}
            {shown.map((c) => link(`${base}/c/${c.slug}`, c.name))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <button type="button" onClick={() => setSearch(true)} aria-label="Rechercher" className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-soft">
              <SearchIcon size={17} />
            </button>
            <button
              type="button"
              onClick={openDrawer}
              aria-label={`Panier, ${count} article${count > 1 ? "s" : ""}`}
              className="flex h-9 items-center gap-2 rounded-md bg-soft px-3 text-[14px] font-semibold tabular-nums hover:bg-black/10"
            >
              <BagIcon size={16} />
              {count}
            </button>
          </div>
        </div>
      </header>

      {menu && (
        <div className="fixed inset-0 z-[80] md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="ui-scrim" onClick={() => setMenu(false)} />
          <nav className="shop-fade-up absolute inset-x-0 top-0 flex flex-col gap-5 bg-white px-5 pt-5 pb-8 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-[18px] font-bold tracking-[-0.03em]">{store.name}</span>
              <button type="button" onClick={() => setMenu(false)} aria-label="Fermer le menu" className="p-1">
                <CloseIcon size={18} />
              </button>
            </div>
            {link(base, "Accueil")}
            {link(`${base}/boutique`, "Tout voir")}
            {cats.map((c) => link(`${base}/c/${c.slug}`, c.name))}
            {store.whatsapp && (
              <a href={`https://wa.me/${store.whatsapp}`} target="_blank" rel="noopener" className="text-[15px] font-medium text-brand">
                Nous écrire sur WhatsApp
              </a>
            )}
          </nav>
        </div>
      )}
      {search && <Search onClose={() => setSearch(false)} />}
    </>
  );
}

function Search({ onClose }: { onClose: () => void }) {
  const { store, products } = useCart();
  const [q, setQ] = useState("");
  const words = q
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const hay = (s: string | null) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const found = words.length
    ? products.filter((p) => !p.draft && words.every((w) => hay(`${p.name} ${p.category} ${p.description}`).includes(w))).slice(0, 8)
    : [];
  return (
    <div className="fixed inset-0 z-[85]" role="dialog" aria-modal="true" aria-label="Rechercher">
      <div className="ui-scrim" onClick={onClose} />
      <div className="shop-fade-up absolute inset-x-0 top-0 bg-white shadow-xl">
        <div className="mx-auto max-w-[952px] px-4 py-4">
          <div className="flex items-center gap-3">
            <SearchIcon size={18} className="text-ink-3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && onClose()}
              placeholder="Rechercher un produit"
              aria-label="Rechercher un produit"
              className="h-11 flex-1 bg-transparent text-[17px] outline-none placeholder:text-ink-3"
            />
            <button type="button" onClick={onClose} aria-label="Fermer la recherche" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5">
              <CloseIcon />
            </button>
          </div>
          {words.length > 0 && (
            <ul className="mt-3 max-h-[60dvh] divide-y divide-black/5 overflow-auto border-t border-black/10">
              {found.length === 0 && <li className="py-6 text-center text-[14px] text-ink-3">Aucun produit ne correspond.</li>}
              {found.map((p) => (
                <li key={p.id}>
                  <Link href={`/${store.slug}/${p.id}`} onClick={onClose} className="flex items-center gap-3 py-2.5 hover:bg-soft">
                    <span className="h-11 w-11 shrink-0 overflow-hidden rounded bg-[#f2f2f2]">
                      {p.cover && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.cover} alt="" className="h-full w-full object-contain mix-blend-multiply" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{p.name}</span>
                      {p.category && <span className="block text-[12px] text-ink-3">{p.category}</span>}
                    </span>
                    <span className="text-[14px] font-medium tabular-nums">{p.price != null ? formatPrice(p.price, store.currency) : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
