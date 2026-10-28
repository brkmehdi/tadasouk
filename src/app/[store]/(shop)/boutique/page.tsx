// Every product of the store, with the category chips, filters and sorting.

import type { Metadata } from "next";
import { loadStore } from "@/lib/storefront";
import { Listing } from "../../_ui/Listing";

type Params = { params: Promise<{ store: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await loadStore((await params).store);
  return found ? { title: `Tous les produits · ${found.store.name}` } : {};
}

export default function AllProducts() {
  return <Listing category={null} />;
}
