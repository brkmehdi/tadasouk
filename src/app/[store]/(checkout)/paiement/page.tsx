import type { Metadata } from "next";
import { sdkUrl, tctConfig } from "@/lib/server/tchentchen";
import { loadStore } from "@/lib/storefront";
import { CheckoutPage } from "../../_ui/Checkout";

export const metadata: Metadata = { title: "Paiement", robots: { index: false } };

// Card payment shows when the merchant switched it on and Tchentchen has a key; the page gets
// only the address of Tchentchen's SDK, never a key.
export default async function Paiement({ params }: { params: Promise<{ store: string }> }) {
  const found = await loadStore((await params).store);
  const cfg = found?.store.card_enabled ? await tctConfig() : null;
  return <CheckoutPage card={cfg ? { sdk: sdkUrl(cfg) } : null} />;
}
