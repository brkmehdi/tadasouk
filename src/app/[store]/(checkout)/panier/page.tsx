import type { Metadata } from "next";
import { CartPage } from "../../_ui/Checkout";

export const metadata: Metadata = { title: "Votre panier", robots: { index: false } };

export default function Panier() {
  return <CartPage />;
}
