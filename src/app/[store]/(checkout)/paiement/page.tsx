import type { Metadata } from "next";
import { checkoutModeOn, sdkUrl, tctConfig } from "@/lib/server/tchentchen";
import { loadStore } from "@/lib/storefront";
import { CheckoutPage } from "../../_ui/Checkout";
import { TchentchenCheckout } from "../../_ui/TchentchenCheckout";

export const metadata: Metadata = { title: "Paiement", robots: { index: false } };

// A store that takes cards, with Tchentchen set up:
//  - checkout mode on (TCHENTCHEN_CHECKOUT_MODE): the page is Tchentchen's checkout, nothing else;
//  - otherwise our checkout, with Tchentchen's card form as one of its rows.
// Without either, our checkout with cash on delivery and credit only. The page gets only the
// address of Tchentchen's SDK, never a key.
export default async function Paiement({ params }: { params: Promise<{ store: string }> }) {
  const found = await loadStore((await params).store);
  const cfg = found?.store.card_enabled ? await tctConfig() : null;
  if (cfg && checkoutModeOn()) return <TchentchenCheckout sdk={sdkUrl(cfg)} />;
  return <CheckoutPage card={cfg ? { sdk: sdkUrl(cfg) } : null} />;
}
