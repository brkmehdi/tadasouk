// A merchant's public store at /{slug}. The cart (and its drawer) lives across the store's pages,
// from the shop to the checkout. The merchant, signed in, sees a preview bar: drafts are shown
// to them only.

import Link from "next/link";
import { notFound } from "next/navigation";
import { loadShipping, loadShop, loadStore } from "@/lib/storefront";
import { CartProvider } from "./_ui/cart";
import { CartDrawer } from "./_ui/CartDrawer";

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ store: string }> }) {
  const found = await loadStore((await params).store);
  if (!found) notFound();
  const { store, owner } = found;
  const [products, shipping] = await Promise.all([loadShop(store.id, owner), loadShipping(store.id)]);

  return (
    <CartProvider
      store={{
        slug: store.slug,
        name: store.name,
        city: store.city,
        currency: store.currency,
        whatsapp: store.whatsapp,
        cod: store.cod_enabled,
        credit: store.credit_enabled,
      }}
      products={products}
      shipping={shipping}
    >
      <div className="min-h-dvh bg-white text-[rgba(26,26,26,0.9)]">
        {owner && (
          <div className="flex items-center gap-3 bg-ink px-4 py-2 text-xs text-white">
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
      <CartDrawer />
    </CartProvider>
  );
}
