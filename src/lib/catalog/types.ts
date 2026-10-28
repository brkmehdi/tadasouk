// Products as saved in the database (supabase/migrations), and what the screens need from them.

import type { Product } from "@/lib/capture/session";

export const mediaUrl = (key: string) => `/media/${key}`;

export type CatalogImage = {
  id: string;
  r2_key: string;
  position: number;
  source: "camera" | "studio" | "ai" | "web";
  color_id: string | null; // the colour this photo shows, when the product has colours
};

export type CatalogColor = { id: string; name: string; hex: string; position: number };

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
  sizes: string[]; // in display order; empty: one size
  soldout: string[]; // "<colour id or empty>:<size or empty>"
  product_images: CatalogImage[];
  product_colors: CatalogColor[];
};

// For supabase-js `select()`: the product, its photos and colours in one request.
// (one string literal: supabase-js reads its type from it)
export const PRODUCT_COLUMNS =
  "id, name, name_ar, description, category, price, compare_at_price, stock, barcode, status, created_at, sizes, soldout, product_images(id, r2_key, position, source, color_id), product_colors(id, name, hex, position)";

export const colorsOf = (p: CatalogProduct) => [...(p.product_colors ?? [])].sort((a, b) => a.position - b.position);
export const soldoutKey = (colorId: string | null, size: string | null) => `${colorId ?? ""}:${size ?? ""}`;

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
