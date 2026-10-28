// A merchant's public store at /{slug}. Its basket lives across the store's pages. The merchant,
// signed in, sees a preview bar: drafts are shown to them only.

import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStore } from "@/lib/storefront";
import { CartBar, CartProvider } from "./Cart";

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ store: string }> }) {
  const found = await loadStore((await params).store);
  if (!found) notFound();
  const { store, owner } = found;

  return (
    <CartProvider
      store={{
        slug: store.slug,
        name: store.name,
        currency: store.currency,
        whatsapp: store.whatsapp,
        cod: store.cod_enabled,
        credit: store.credit_enabled,
      }}
    >
      <div className="min-h-dvh bg-white pb-28 text-ink">
        {owner && (
          <div className="sticky top-0 z-30 flex items-center gap-3 bg-ink px-4 py-2 text-xs text-white">
            <span className="flex-1">
              Aperçu de votre boutique{store.published ? "" : " : elle n'est pas encore en ligne"}. Les brouillons ne sont visibles que par vous.
            </span>
            <Link href="/app" className="shrink-0 font-semibold underline">
              Back office
            </Link>
          </div>
        )}
        {children}
      </div>
      <CartBar />
    </CartProvider>
  );
}
