"use client";

// The cart sliding in from the right: delivery progress, lines, totals and promotion code,
// a suggestion, then "Commander" and a link to the full cart page with the delivery options.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCart } from "./cart";
import { PayButton } from "./controls";
import { CloseIcon } from "./icons";
import { FreeShippingBar, Lines, Totals } from "./Summary";
import { suggestions, Upsell } from "./Upsell";

export function CartDrawer() {
  const cart = useCart();
  const router = useRouter();
  const [going, setGoing] = useState(false);
  const { drawer, closeDrawer, count, lines, store, products, byId, quote } = cart;

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeDrawer();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawer, closeDrawer]);

  if (!drawer) return null;
  const inCart = new Set(lines.map((l) => l.product_id));
  const offers = suggestions(products, lines.map((l) => byId.get(l.product_id)?.category ?? null), inCart, 6);
  const blocked = quote?.lines.some((l) => !l.ok) ?? false;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Votre panier">
      <div className="ui-scrim" onClick={closeDrawer} />
      <aside className="shop-drawer text-ink">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3.5">
          <span className="text-[16px] font-bold tracking-[-0.01em]">Votre panier</span>
          {count > 0 && <span className="text-[14px] text-ink-3">{count} article{count > 1 ? "s" : ""}</span>}
          <button type="button" onClick={closeDrawer} aria-label="Fermer le panier" className="ms-auto flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5">
            <CloseIcon />
          </button>
        </div>

        {count === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-[16px] font-bold">Votre panier est vide</p>
            <p className="text-[14px] text-ink-3">Les meilleures ventes sont un bon point de départ.</p>
            <Link href={`/${store.slug}/boutique`} onClick={closeDrawer} className="ui-btn ui-btn-primary mt-3 h-11 px-6">
              Voir les produits
            </Link>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
              <FreeShippingBar />
              <div className="mt-5">
                <Lines />
              </div>
              <div className="mt-4">
                <Totals />
              </div>
              <Upsell title="Ajoutez à votre commande" items={offers} />
            </div>
            <div className="border-t border-line px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <PayButton
                state={going ? "busy" : blocked ? "idle" : "ready"}
                label="Commander"
                busyLabel="Commander"
                onClick={() => {
                  if (blocked) return;
                  setGoing(true);
                  router.push(`/${store.slug}/paiement`);
                }}
                className="h-12"
              />
              <Link href={`/${store.slug}/panier`} onClick={closeDrawer} className="mt-3 block text-center text-[14px] underline underline-offset-2">
                Voir le panier et la livraison
              </Link>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
