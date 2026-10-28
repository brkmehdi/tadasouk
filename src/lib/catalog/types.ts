// Products as saved in the database (supabase/migrations), and what the screens need from them.

import type { Product } from "@/lib/capture/session";

export const mediaUrl = (key: string) => `/media/${key}`;

export type CatalogImage = { id: string; r2_key: string; position: number; source: "camera" | "studio" | "ai" | "web" };

export type CatalogProduct = {
  id: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  category: string | null;
  price: number | null;
  compare_at_price: number | null;
  stock: number | null;
  barcode: string | null;
  status: "draft" | "published" | "archived";
  created_at: string;
  product_images: CatalogImage[];
};

// For supabase-js `select()`: the product and its photos in one request.
export const PRODUCT_COLUMNS =
  "id, name, name_ar, description, category, price, compare_at_price, stock, barcode, status, created_at, product_images(id, r2_key, position, source)";

export const photosOf = (p: CatalogProduct) => [...p.product_images].sort((a, b) => a.position - b.position);

export const coverOf = (p: CatalogProduct) => {
  const first = photosOf(p)[0];
  return first ? mediaUrl(first.r2_key) : null;
};

// The sale screen works on capture-session products: give it the saved ones in that shape.
export function toSessionProduct(p: CatalogProduct, currency: string, order: number): Product {
  return {
    id: p.id,
    order,
    name: p.name || null,
    aiFilled: { name: false, description: false },
    nameAr: p.name_ar,
    category: p.category,
    barcode: p.barcode,
    identify: "done",
    research: "done",
    label: null,
    color: null,
    images: photosOf(p).map((i) => ({ id: i.id, url: mediaUrl(i.r2_key), source: i.source, pending: false })),
    description: p.description,
    price: p.price,
    compareAtPrice: p.compare_at_price,
    currency,
    quantity: p.stock,
    question: null,
    status: "active",
    online: p.status === "published",
    photos: "idle",
    priceCheck: null,
    capturedAt: Date.parse(p.created_at),
  };
}
