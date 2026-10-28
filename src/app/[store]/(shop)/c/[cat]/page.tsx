// One category of the store (its slug comes from the category's name).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { categoriesOf } from "@/lib/shop";
import { loadShop, loadStore } from "@/lib/storefront";
import { Listing } from "../../../_ui/Listing";

type Params = { params: Promise<{ store: string; cat: string }> };

async function load(params: Params["params"]) {
  const { store: slug, cat } = await params;
  const found = await loadStore(slug);
  if (!found) return null;
  const products = await loadShop(found.store.id, found.owner);
  const category = categoriesOf(products.filter((p) => !p.draft || found.owner)).find((c) => c.slug === decodeURIComponent(cat));
  return category ? { store: found.store, category } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await load(params);
  return found ? { title: `${found.category.name} · ${found.store.name}` } : {};
}

export default async function CategoryPage({ params }: Params) {
  const found = await load(params);
  if (!found) notFound();
  return <Listing category={found.category.slug} />;
}
