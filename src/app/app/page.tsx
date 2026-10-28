// The merchant's back office. Signed out: go sign in. No store yet: name it first.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, serverSupabase } from "@/lib/server/auth";
import BackOffice from "./BackOffice";
import Onboarding from "./Onboarding";

export const metadata: Metadata = { title: "Ma boutique · SmallStore" };

export default async function AppPage() {
  const user = await currentUser();
  if (!user) redirect("/connexion");

  const { data: store } = await (await serverSupabase())
    .from("stores")
    .select("id, name, slug, city, whatsapp, published")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!store) return <Onboarding userId={user.id} phone={user.phone} />;
  return <BackOffice store={store} />;
}
