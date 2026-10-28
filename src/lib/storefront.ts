// What the public store pages read. Everything goes through the visitor's own session, so row
// level security decides: a customer sees published stores and products only; the merchant,
// signed in, also sees their drafts (that is the preview). `cache` shares one read between the
// layout, the page and its metadata.

import { headers } from "next/headers";
import { cache } from "react";
import { PRODUCT_COLUMNS, type CatalogProduct } from "@/lib/catalog/types";
import { currentUser, serverSupabase } from "@/lib/server/auth";

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

// Absolute links for WhatsApp and search engines (they need https://host/...).
export async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
