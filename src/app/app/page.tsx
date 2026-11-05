// The merchant's back office. Signed out: go sign in. No store yet: name it first.
// Everything is read with the merchant's own session, so row level security applies.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ORDER_COLUMNS, type Order } from "@/lib/catalog/orders";
import { PROMO_COLUMNS, SHIPPING_COLUMNS, type PromoCode, type ShippingMethod } from "@/lib/catalog/store-settings";
import { PRODUCT_COLUMNS, type CatalogProduct } from "@/lib/catalog/types";
import { LANG_COOKIE, readLang } from "@/lib/lang";
import { currentUser, serverSupabase } from "@/lib/server/auth";
import BackOffice, { type Store } from "./BackOffice";
import Onboarding from "./Onboarding";

export const metadata: Metadata = { title: "Ma boutique · Tadasouk" };

// `?instagram=`: back from Meta's Instagram login (src/app/api/instagram/callback).
export default async function AppPage({ searchParams }: { searchParams: Promise<{ instagram?: string | string[] }> }) {
  const back = (await searchParams).instagram;
  const user = await currentUser();
  if (!user) redirect("/connexion");
  const lang = readLang((await cookies()).get(LANG_COOKIE)?.value);
  const db = await serverSupabase();

  const { data: store } = await db
    .from("stores")
    .select("id, name, slug, city, whatsapp, currency, published, cod_enabled, card_enabled, credit_enabled, tagline, hero_key, marketplace_margin, marketplaces")
    .eq("owner_id", user.id)
    .maybeSingle<Omit<Store, "rib">>();
  if (!store) return <Onboarding userId={user.id} phone={user.phone} />;
  // The RIB is not readable with the stores (it would be public): only through this function.
  const { data: rib } = await db.rpc("my_store_rib");

  const [{ data: products }, { data: orders }, { data: profile }, { data: wallet }, { data: shipping }, { data: promos }] = await Promise.all([
    db.from("products").select(PRODUCT_COLUMNS).eq("store_id", store.id).neq("status", "archived").order("created_at", { ascending: false }),
    db.from("orders").select(ORDER_COLUMNS).eq("store_id", store.id).order("created_at", { ascending: false }).limit(100),
    db.from("profiles").select("ai_access").eq("id", user.id).maybeSingle<{ ai_access: "pending" | "active" }>(),
    db.from("ai_wallets").select("balance_usd").eq("user_id", user.id).maybeSingle<{ balance_usd: number }>(),
    db.from("shipping_methods").select(SHIPPING_COLUMNS).eq("store_id", store.id).order("position").order("price"),
    db.from("promo_codes").select(PROMO_COLUMNS).eq("store_id", store.id).order("created_at", { ascending: false }),
  ]);
  const ai = { pending: profile?.ai_access !== "active", balance: Number(wallet?.balance_usd ?? 0) };

  return (
    <BackOffice
      store={{ ...store, rib: (rib as string | null) ?? null }}
      products={(products ?? []) as CatalogProduct[]}
      orders={(orders ?? []) as Order[]}
      shipping={(shipping ?? []).map((m) => ({ ...m, price: Number(m.price), free_over: m.free_over == null ? null : Number(m.free_over) })) as ShippingMethod[]}
      promos={(promos ?? []).map((c) => ({ ...c, value: Number(c.value), min_subtotal: Number(c.min_subtotal) })) as PromoCode[]}
      ai={ai}
      lang={lang}
      instagram={typeof back === "string" ? back : null}
    />
  );
}
