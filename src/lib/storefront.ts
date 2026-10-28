// What the public store pages read. Everything goes through the visitor's own session, so row
// level security decides: a customer sees published stores and products only; the merchant,
// signed in, also sees their drafts (that is the preview). `cache` shares one read between the
// layout, the page and its metadata.

import { headers } from "next/headers";
import { cache } from "react";
import { colorsOf, mediaUrl, photosOf, PRODUCT_COLUMNS, type CatalogProduct } from "@/lib/catalog/types";
import { currentUser, serverSupabase } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { categorySlug, type ShippingOption, type ShopProduct } from "@/lib/shop";

export type PublicStore = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  tagline: string | null;
  hero_key: string | null;
  city: string | null;
  whatsapp: string | null;
  currency: string;
  published: boolean;
  cod_enabled: boolean;
  credit_enabled: boolean;
  card_enabled: boolean;
};

export const loadStore = cache(async (slug: string) => {
  const db = await serverSupabase();
  const { data } = await db
    .from("stores")
    .select("id, owner_id, name, slug, tagline, hero_key, city, whatsapp, currency, published, cod_enabled, credit_enabled, card_enabled")
    .eq("slug", slug)
    .maybeSingle<PublicStore>();
  if (!data) return null;
  const owner = (await currentUser())?.id === data.owner_id;
  return { store: data, owner };
});

export const loadProducts = cache(async (storeId: string, owner: boolean) => {
  const db = await serverSupabase();
  let q = db.from("products").select(PRODUCT_COLUMNS).eq("store_id", storeId);
  q = owner ? q.neq("status", "archived") : q.eq("status", "published");
  const { data } = await q.order("created_at", { ascending: false });
  return (data ?? []) as CatalogProduct[];
});

export const loadProduct = cache(async (storeId: string, id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await serverSupabase();
  const { data } = await db.from("products").select(PRODUCT_COLUMNS).eq("store_id", storeId).eq("id", id).maybeSingle();
  return (data as CatalogProduct | null) ?? null;
});

// What every page of the store needs about each product (menu, search, cards, suggestions,
// cart lines): small enough to send to the browser once, from the store's layout.
export function toShopProduct(p: CatalogProduct): ShopProduct {
  const photos = photosOf(p);
  const colors = colorsOf(p).map((c) => {
    const own = photos.find((i) => i.color_id === c.id);
    return { id: c.id, name: c.name, hex: c.hex, cover: own ? mediaUrl(own.r2_key) : null };
  });
  return {
    id: p.id,
    name: p.name || "Produit",
    description: p.description,
    category: p.category?.trim() || null,
    categorySlug: p.category?.trim() ? categorySlug(p.category) : null,
    price: p.price,
    compareAt: p.compare_at_price != null && p.price != null && p.compare_at_price > p.price ? p.compare_at_price : null,
    cover: photos[0] ? mediaUrl(photos[0].r2_key) : null,
    colors,
    sizes: p.sizes ?? [],
    soldout: p.soldout ?? [],
    inStock: p.stock == null || p.stock > 0,
    draft: p.status !== "published",
    createdAt: p.created_at,
  };
}

export const loadShop = cache(async (storeId: string, owner: boolean) => (await loadProducts(storeId, owner)).map(toShopProduct));

export const loadShipping = cache(async (storeId: string) => {
  const db = await serverSupabase();
  const { data } = await db
    .from("shipping_methods")
    .select("id, name, price, free_over, delay_days")
    .eq("store_id", storeId)
    .eq("active", true)
    .order("position")
    .order("price");
  return (data ?? []).map((m) => ({ ...m, price: Number(m.price), free_over: m.free_over == null ? null : Number(m.free_over) })) as ShippingOption[];
});

// The store's most ordered products (cancelled orders aside). Read by the server: buyers cannot
// read orders, and only product ids come out.
export const bestSellerIds = cache(async (storeId: string) => {
  try {
    const rows = await withDb(
      (sql) => sql<{ product_id: string }[]>`
        select i.product_id from public.order_items i join public.orders o on o.id = i.order_id
        where i.store_id = ${storeId} and o.status <> 'cancelled' and i.product_id is not null
        group by i.product_id order by sum(i.quantity) desc limit 8`,
    );
    return rows.map((r) => r.product_id);
  } catch {
    return [];
  }
});

// Absolute links for WhatsApp and search engines (they need https://host/...).
export async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
