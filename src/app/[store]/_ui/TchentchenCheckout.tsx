"use client";

// Checkout mode: /paiement holds only Tchentchen's checkout, in a frame drawn by its SDK (script tag
// from Tchentchen, not in this repository). The server turns the cart into a checkout
// (/api/pay/checkout); Tchentchen takes the contact, the address, the delivery choice and the
// payment (card or cash on delivery) and calls our order hook. After the receipt the SDK opens the
// thank-you page. Coming back from a payment method that left the page (?tct_resume=...), the
// checkout is resumed instead of created again. If anything fails, our own checkout shows instead.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { loadSdk, type CheckoutOptions } from "./CardPayment";
import { CheckoutPage } from "./Checkout";
import { useCart } from "./cart";

export function TchentchenCheckout({ sdk }: { sdk: string }) {
  const { store, lines, promo, shippingId, clear } = useCart();
  const router = useRouter();
  const started = useRef(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (started.current || !lines.length) return;
    started.current = true;
    const resuming = new URLSearchParams(window.location.search).has("tct_resume");
    const back = `/${store.slug}/panier`;
    const create = async () => {
      const res = await fetch("/api/pay/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: store.slug,
          items: lines.map((l) => ({ product_id: l.product_id, quantity: l.qty, color_id: l.color_id, size: l.size })),
          shipping: shippingId,
          promo,
        }),
      }).catch(() => null);
      const b = (await res?.json().catch(() => null)) as { checkout_url?: string } | null;
      return res?.ok && b?.checkout_url ? b.checkout_url : null;
    };
    // No mount: the SDK draws the checkout over the whole window, on every screen (as it always
    // does on a phone). Its frame then picks its own layout from the window's width: summary beside
    // the form on a laptop, stacked on a phone, as on Tchentchen's own page.
    const options: Omit<CheckoutOptions, "checkoutUrl"> = {
      onComplete: ({ redirectUrl }) => {
        clear();
        window.location.assign(redirectUrl); // the thank-you page of the order, on our own site
      },
      onClose: () => router.push(back),
      onRenew: create,
    };
    void (async () => {
      try {
        const tct = (await loadSdk(sdk))({ locale: "fr" });
        if (resuming && tct.checkout.resume(options)) return;
        const url = await create();
        if (!url) throw new Error("no checkout");
        tct.checkout.open({ ...options, checkoutUrl: url });
      } catch {
        setFallback(true); // Tchentchen unreachable or refused: our own checkout, with the card row
      }
    })();
  }, [lines, promo, shippingId, store.slug, sdk, clear, router]);

  // Our own checkout when Tchentchen failed, and for an empty cart (its "panier vide" message).
  if (fallback || !lines.length) return <CheckoutPage card={{ sdk }} />;
  // A blank page while the checkout loads, over everything the store's layout shows (the owner's
  // preview band included): the shopper only ever sees Tchentchen's checkout, whose header has the
  // store's name and the way back to the cart.
  return <main aria-busy="true" className="fixed inset-0 z-[2147482000] bg-white" />;
}
