import type { Metadata } from "next";
import { CheckoutPage } from "../../_ui/Checkout";

export const metadata: Metadata = { title: "Paiement", robots: { index: false } };

export default function Paiement() {
  return <CheckoutPage />;
}
