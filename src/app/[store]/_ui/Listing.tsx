"use client";

// All products, or one category: the category chips, filters (colour, size), sorting, the grid.

import Link from "next/link";
import { useState } from "react";
import { categoriesOf, type ShopProduct } from "@/lib/shop";
import { useCart } from "./cart";
import { Dialog } from "./controls";
import { CloseIcon, SlidersIcon } from "./icons";
import { ProductGrid } from "./ProductCard";

type Sort = "featured" | "low" | "high" | "new";
const SORTS: [Sort, string][] = [
  ["featured", "Tri : en avant"],
  ["low", "Prix croissant"],
  ["high", "Prix décroissant"],
  ["new", "Nouveautés"],
];

export function Listing({ category }: { category: string | null }) {
  const { store, products } = useCart();
  const [sort, setSort] = useState<Sort>("featured");
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [filtering, setFiltering] = useState(false);

  const visible = products.filter((p) => !p.draft || category === null);
  const cats = categoriesOf(products.filter((p) => !p.draft));
  const cat = cats.find((c) => c.slug === category);
  const inCat = category ? visible.filter((p) => p.categorySlug === category) : visible;
  const allColors = [...new Set(inCat.flatMap((p) => p.colors.map((c) => c.name)))];
  const allSizes = [...new Set(inCat.flatMap((p) => p.sizes))];
  const hex = (name: string) => inCat.flatMap((p) => p.colors).find((c) => c.name === name)?.hex ?? "#ddd";

  let list = inCat;
  if (colors.length) list = list.filter((p) => p.colors.some((c) => colors.includes(c.name)));
  if (sizes.length) list = list.filter((p) => p.sizes.some((s) => sizes.includes(s)));
  const price = (p: ShopProduct) => p.price ?? Number.MAX_SAFE_INTEGER;
  if (sort === "low") list = [...list].sort((a, b) => price(a) - price(b));
  if (sort === "high") list = [...list].sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  if (sort === "new") list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const nf = colors.length + sizes.length;
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const base = `/${store.slug}`;

  return (
    <div className="pt-10">
      <p className="text-[16px] font-medium text-ink-3">Boutique</p>
      <h1 className="mt-1 text-[30px] font-extrabold tracking-[-0.035em] text-[#16151A]">{cat?.name ?? "Tous les produits"}</h1>
      <p className="mt-1 text-[14px] text-ink-3">
        {list.length} produit{list.length > 1 ? "s" : ""}
      </p>

      {cats.length > 0 && (
        <div className="no-scrollbar -mx-4 mt-6 flex gap-2 overflow-x-auto px-4">
          <Link href={`${base}/boutique`} className={`shop-chip ${!category ? "shop-chip-on" : ""}`}>
            Tout <span className="opacity-60">{products.filter((p) => !p.draft).length}</span>
          </Link>
          {cats.map((c) => (
            <Link key={c.slug} href={`${base}/c/${c.slug}`} className={`shop-chip ${category === c.slug ? "shop-chip-on" : ""}`}>
              {c.name} <span className="opacity-60">{c.count}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        {allColors.length + allSizes.length > 0 ? (
          <button type="button" onClick={() => setFiltering(true)} className="shop-chip">
            <SlidersIcon size={14} />
            Filtres{nf ? <span className="opacity-60">{nf}</span> : null}
          </button>
        ) : (
          <span />
        )}
        <label className="relative">
          <span className="sr-only">Trier par</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="ui-input h-9 w-auto appearance-none pe-9 text-[14px]">
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <svg width="12" height="12" viewBox="0 0 12 12" className="pointer-events-none absolute end-3 top-1/2 -mt-1.5" aria-hidden>
            <path d="m2 4 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </label>
      </div>

      {nf > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[...colors.map((c) => ["c", c]), ...sizes.map((s) => ["s", s])].map(([k, v]) => (
            <span key={k + v} className="inline-flex items-center rounded-md bg-black/10 px-3 py-1.5 text-[14px] font-medium">
              {k === "s" ? `Taille ${v}` : v}
              <button
                type="button"
                aria-label={`Retirer ${v}`}
                onClick={() => (k === "c" ? setColors(colors.filter((x) => x !== v)) : setSizes(sizes.filter((x) => x !== v)))}
                className="ms-1.5 p-0.5"
              >
                <CloseIcon size={12} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => {
              setColors([]);
              setSizes([]);
            }}
            className="text-[14px] underline underline-offset-2"
          >
            Tout effacer
          </button>
        </div>
      )}

      <div className="mt-6">
        {list.length ? (
          <ProductGrid products={list} slug={store.slug} currency={store.currency} cols={3} />
        ) : (
          <p className="py-16 text-center text-[14px] text-ink-3">
            {nf ? "Aucun produit ne correspond à ces filtres." : "Pas encore de produit ici."}
          </p>
        )}
      </div>

      {filtering && (
        <Dialog title={<p className="text-[14px] font-medium">Filtres</p>} onClose={() => setFiltering(false)}>
          <div className="flex flex-col gap-6 px-5 py-5">
            {allColors.length > 0 && (
              <div>
                <p className="ui-label">Couleur</p>
                <div className="flex flex-wrap gap-2">
                  {allColors.map((c) => (
                    <button key={c} type="button" onClick={() => setColors(toggle(colors, c))} className={`shop-chip ${colors.includes(c) ? "shop-chip-on" : ""}`}>
                      <span className="h-3 w-3 rounded-full ring-1 ring-black/15" style={{ background: hex(c) }} />
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {allSizes.length > 0 && (
              <div>
                <p className="ui-label">Taille</p>
                <div className="flex flex-wrap gap-2">
                  {allSizes.map((s) => (
                    <button key={s} type="button" onClick={() => setSizes(toggle(sizes, s))} className={`shop-chip ${sizes.includes(s) ? "shop-chip-on" : ""}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button type="button" onClick={() => setFiltering(false)} className="ui-btn ui-btn-primary h-11">
              Voir {list.length} produit{list.length > 1 ? "s" : ""}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
