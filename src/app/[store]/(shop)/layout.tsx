// The browsing pages of a store (home, categories, products) share its header and foot; the
// cart and checkout pages keep only the store's name, like a checkout.

import { loadShop, loadStore } from "@/lib/storefront";
import { Footer } from "../_ui/Footer";
import { Header } from "../_ui/Header";

export default async function ShopLayout({ children, params }: { children: React.ReactNode; params: Promise<{ store: string }> }) {
  const found = await loadStore((await params).store);
  if (!found) return children;
  const { store, owner } = found;
  const products = await loadShop(store.id, owner);
  return (
    <>
      <Header />
      <main className="mx-auto max-w-[952px] px-4">{children}</main>
      <Footer
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
      />
    </>
  );
}
