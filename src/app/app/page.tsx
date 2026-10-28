// The merchant's back office. Signed out: go sign in. No store yet: name it first.
// Everything is read with the merchant's own session, so row level security applies.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PRODUCT_COLUMNS, type CatalogProduct } from "@/lib/catalog/types";
import { LANG_COOKIE, readLang } from "@/lib/lang";
import { currentUser, serverSupabase } from "@/lib/server/auth";
import BackOffice, { type Store } from "./BackOffice";
import Onboarding from "./Onboarding";

export const metadata: Metadata = { title: "Ma boutique · SmallStore" };

export default async function AppPage() {
  const user = await currentUser();
  if (!user) redirect("/connexion");
  const lang = readLang((await cookies()).get(LANG_COOKIE)?.value);
  const db = await serverSupabase();

  const { data: store } = await db
    .from("stores")
    .select("id, name, slug, city, whatsapp, currency, published, cod_enabled, card_enabled, credit_enabled")
    .eq("owner_id", user.id)
    .maybeSingle<Store>();
  if (!store) return <Onboarding userId={user.id} phone={user.phone} />;

  const [{ data: products }, { count: orders }] = await Promise.all([
    db.from("products").select(PRODUCT_COLUMNS).eq("store_id", store.id).neq("status", "archived").order("created_at", { ascending: false }),
    db.from("orders").select("id", { count: "exact", head: true }).eq("store_id", store.id),
  ]);

  return <BackOffice store={store} products={(products ?? []) as CatalogProduct[]} orders={orders ?? 0} lang={lang} />;
}
