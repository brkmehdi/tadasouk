"use client";

// "Ajoutez à votre commande" in the cart, "Va bien avec" on a product page: one suggestion at a
// time with arrows. A product without colour or size goes straight into the cart; the others
// open their page so the buyer can choose.

import Link from "next/link";
import { useState } from "react";
import { formatPrice } from "@/lib/money";
import { hasOptions, type ShopProduct } from "@/lib/shop";
import { useCart } from "./cart";
import { BackIcon, NextIcon, PlusIcon } from "./icons";

export function Upsell({ title, items }: { title: string; items: ShopProduct[] }) {
  const { store, add, openDrawer } = useCart();
  const [index, setIndex] = useState(0);
  const [added, setAdded] = useState<string | null>(null);
  if (!items.length) return null;
  const i = Math.min(index, items.length - 1);
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[16px] font-medium">{title}</p>
        {items.length > 1 && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setIndex(i - 1)} disabled={i === 0} aria-label="Précédent" className="shop-arrow">
              <BackIcon size={12} />
            </button>
            <button type="button" onClick={() => setIndex(i + 1)} disabled={i >= items.length - 1} aria-label="Suivant" className="shop-arrow">
              <NextIcon size={12} />
            </button>
          </div>
        )}
      </div>
      <div className="overflow-hidden">
        <div className="flex transition-transform duration-500 ease-in-out" style={{ transform: `translateX(-${i * 100}%)` }}>
          {items.map((p) => (
            <div key={p.id} className="w-full shrink-0 p-0.5">
              <div className="flex gap-3 rounded-md p-4 ring-1 ring-black/10">
                <Link href={`/${store.slug}/${p.id}`} className="h-[42px] w-[42px] shrink-0 overflow-hidden rounded bg-[#f2f2f2]">
                  {p.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.cover} alt="" className="h-full w-full object-contain mix-blend-multiply" />
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/${store.slug}/${p.id}`} className="min-w-0 text-[14px] font-medium">
                      {p.name}
                    </Link>
                    <span className="shrink-0 text-[14px] font-medium tabular-nums">{p.price != null ? formatPrice(p.price, store.currency) : ""}</span>
                  </div>
                  {(p.category || p.description) && <p className="mb-3 line-clamp-1 text-[12px] text-ink-3">{p.category ?? p.description}</p>}
                  {hasOptions(p) ? (
                    <Link href={`/${store.slug}/${p.id}`} className="shop-mini">
                      Choisir
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="shop-mini"
                      disabled={added === p.id}
                      onClick={() => {
                        add(p.id, null, null, 1);
                        setAdded(p.id);
                        openDrawer();
                      }}
                    >
                      <PlusIcon size={10} />
                      {added === p.id ? "Ajouté" : "Ajouter"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Products to suggest: same categories first, never what is already in the cart.
export function suggestions(products: ShopProduct[], categories: (string | null)[], exclude: Set<string>, n = 6) {
  const pool = products.filter((p) => !exclude.has(p.id) && !p.draft && p.inStock && p.price != null);
  const same = pool.filter((p) => p.category && categories.includes(p.category));
  const rest = pool.filter((p) => !same.includes(p));
  return [...same, ...rest].slice(0, n);
}
