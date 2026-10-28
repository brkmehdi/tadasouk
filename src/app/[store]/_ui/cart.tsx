"use client";

// The buyer's cart for one store, kept in this browser (localStorage): lines (product, colour,
// size, quantity), the promotion code and the delivery method. Prices always come from the
// database (/api/cart/quote); the order is priced again by place_order.

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Quote, ShippingOption, ShopProduct } from "@/lib/shop";

export type ShopStore = {
  slug: string;
  name: string;
  city: string | null;
  currency: string;
  whatsapp: string | null;
  cod: boolean;
  credit: boolean;
};
export type Line = { key: string; product_id: string; color_id: string | null; size: string | null; qty: number };
type Saved = { lines: Line[]; promo: string | null; shipping: string | null };

const EMPTY: Saved = { lines: [], promo: null, shipping: null };
const listeners = new Set<() => void>();
const storageKey = (slug: string) => `smallstore.cart.v2.${slug}`;
let cache: { slug: string; raw: string | null; value: Saved } = { slug: "", raw: null, value: EMPTY };

function read(slug: string): Saved {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(slug));
  } catch {
    return cache.slug === slug ? cache.value : EMPTY;
  }
  if (cache.slug === slug && cache.raw === raw) return cache.value;
  let value = EMPTY;
  try {
    const v = raw ? (JSON.parse(raw) as Saved) : null;
    if (v && Array.isArray(v.lines)) value = { lines: v.lines, promo: v.promo ?? null, shipping: v.shipping ?? null };
  } catch {
    // a broken entry starts an empty cart
  }
  cache = { slug, raw, value };
  return value;
}

function write(slug: string, value: Saved) {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(storageKey(slug), raw);
  } catch {
    // private mode: the cart lives as long as the page
  }
  cache = { slug, raw, value };
  listeners.forEach((l) => l());
}

export const lineKey = (productId: string, colorId: string | null, size: string | null) => `${productId}|${colorId ?? ""}|${size ?? ""}`;

type Cart = {
  store: ShopStore;
  products: ShopProduct[];
  byId: Map<string, ShopProduct>;
  shipping: ShippingOption[];
  lines: Line[];
  count: number;
  promo: string | null;
  shippingId: string | null;
  quote: Quote | null; // for the current lines, promotion and delivery; null while it loads
  add: (productId: string, colorId: string | null, size: string | null, qty: number) => void;
  setQty: (key: string, qty: number) => void;
  setPromo: (code: string | null) => void;
  setShipping: (id: string) => void;
  clear: () => void;
  drawer: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const Ctx = createContext<Cart | null>(null);

export function CartProvider(props: { store: ShopStore; products: ShopProduct[]; shipping: ShippingOption[]; children: React.ReactNode }) {
  const { store } = props;
  const saved = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      const onStorage = (e: StorageEvent) => e.key === storageKey(store.slug) && l();
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => read(store.slug),
    () => EMPTY,
  );
  // The drawer belongs to the page it was opened on: changing page closes it.
  const path = usePathname();
  const [drawerAt, setDrawerAt] = useState<string | null>(null);
  const [quoted, setQuoted] = useState<{ for: string; quote: Quote } | null>(null);

  const update = useCallback((fn: (s: Saved) => Saved) => write(store.slug, fn(read(store.slug))), [store.slug]);
  const byId = useMemo(() => new Map(props.products.map((p) => [p.id, p])), [props.products]);

  // Ask the database for prices whenever the cart changes.
  const items = saved.lines.map((l) => ({ product_id: l.product_id, quantity: l.qty, color_id: l.color_id, size: l.size }));
  const inputs = JSON.stringify({ items, promo: saved.promo, shipping: saved.shipping });
  useEffect(() => {
    if (!saved.lines.length) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch("/api/cart/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: store.slug, ...JSON.parse(inputs) }),
        signal: ctl.signal,
      })
        .then((r) => (r.ok ? (r.json() as Promise<Quote>) : null))
        .then((q) => q && setQuoted({ for: inputs, quote: q }))
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [inputs, saved.lines.length, store.slug]);

  const value: Cart = {
    store,
    products: props.products,
    byId,
    shipping: props.shipping,
    lines: saved.lines,
    count: saved.lines.reduce((n, l) => n + l.qty, 0),
    promo: saved.promo,
    shippingId: saved.shipping,
    quote: saved.lines.length && quoted?.for === inputs ? quoted.quote : null,
    add: (productId, colorId, size, qty) =>
      update((s) => {
        const key = lineKey(productId, colorId, size);
        const found = s.lines.find((l) => l.key === key);
        const lines = found
          ? s.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(99, l.qty + qty) } : l))
          : [...s.lines, { key, product_id: productId, color_id: colorId, size, qty: Math.min(99, qty) }];
        return { ...s, lines };
      }),
    setQty: (key, qty) =>
      update((s) => ({
        ...s,
        lines: qty > 0 ? s.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(99, qty) } : l)) : s.lines.filter((l) => l.key !== key),
      })),
    setPromo: (code) => update((s) => ({ ...s, promo: code?.trim().toUpperCase() || null })),
    setShipping: (id) => update((s) => ({ ...s, shipping: id })),
    clear: () => update(() => EMPTY),
    drawer: drawerAt === path,
    openDrawer: () => setDrawerAt(path),
    closeDrawer: () => setDrawerAt(null),
  };
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
