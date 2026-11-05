"use client";

// Every product filmed is saved as a draft of the merchant's store, and kept in step while it
// changes on the capture screen: name, price, stock, description, photos, online or not.
// Photos go to R2 through /api/media; rows go through Supabase with the merchant's own session
// (row level security keeps them in their store). Saving never blocks filming: changes are
// queued per product and a failed save is tried again on the next change.

import type { Product, ProductImage } from "@/lib/capture/session";
import { supabase } from "@/lib/supabase/browser";

// Photos from shops help the merchant choose; only one that became the main photo is published.
const keepsPhoto = (img: ProductImage, at: number) => !img.pending && (img.source !== "web" || at === 0) && !!img.url;

// A product is worth saving once it has a real photo, or a name given by voice.
const worthSaving = (p: Product) => p.status === "removing" || p.images.some(keepsPhoto) || !!p.name;

type Saved = { row: string; photos: Map<string, number>; scored: Set<string> }; // photo id -> position saved

export function createCatalogSync(storeId: string, onError: (message: string) => void) {
  const saved = new Map<string, Saved>();
  const waiting = new Map<string, Product>();
  const running = new Set<string>();
  let storeOnline = false; // a product put online (button or voice) puts the store online too

  const row = (p: Product) => ({
    id: p.id,
    store_id: storeId,
    name: p.name ?? "",
    name_ar: p.nameAr,
    description: p.description,
    category: p.category,
    price: p.price,
    compare_at_price: p.compareAtPrice,
    stock: p.quantity,
    barcode: p.barcode,
    status: p.online ? "published" : "draft",
    ai_filled: p.aiFilled,
    price_check: p.priceCheck,
    capture_ref: p.id,
  });

  async function upload(p: Product, img: ProductImage) {
    if (img.source === "web") {
      const q = new URLSearchParams({ product: p.id, image: img.id, from: img.url });
      const res = await fetch(`/api/media?${q}`, { method: "POST" });
      // The shop refused it: the next photo becomes the store's main photo.
      if (res.status === 422) return null;
      if (!res.ok) throw new Error(`photo copy ${res.status}`);
      return ((await res.json()) as { key: string }).key;
    }
    const blob = await (await fetch(img.url)).blob();
    const type = blob.type && blob.type !== "application/octet-stream" ? blob.type : "image/jpeg";
    const res = await fetch(`/api/media?product=${p.id}&image=${img.id}`, {
      method: "POST",
      headers: { "Content-Type": type },
      body: blob,
    });
    if (!res.ok) throw new Error(`photo upload ${res.status}`);
    return ((await res.json()) as { key: string }).key;
  }

  async function save(p: Product) {
    const db = supabase();
    if (p.status === "removing") {
      if (saved.has(p.id)) await db.from("products").delete().eq("id", p.id);
      saved.delete(p.id);
      return;
    }
    const s: Saved = saved.get(p.id) ?? { row: "", photos: new Map(), scored: new Set() };
    const r = row(p);
    const sig = JSON.stringify(r);
    if (s.row !== sig) {
      const { error } = await db.from("products").upsert(r);
      if (error) throw new Error(error.message);
      s.row = sig;
      saved.set(p.id, s);
    }
    if (p.online && !storeOnline) {
      const { error } = await db.from("stores").update({ published: true }).eq("id", storeId).eq("published", false);
      if (error) throw new Error(error.message);
      storeOnline = true;
    }

    const photos = p.images.filter(keepsPhoto);
    for (const [position, img] of photos.entries()) {
      const at = s.photos.get(img.id);
      const quality = typeof img.quality === "object" ? img.quality : null;
      if (at === position && (!quality || s.scored.has(img.id))) continue;
      if (at === undefined) {
        const key = await upload(p, img);
        if (!key) continue;
        const { error } = await db.from("product_images").upsert({
          id: img.id,
          product_id: p.id,
          store_id: storeId,
          r2_key: key,
          source: img.source,
          label: null,
          credit: img.credit ?? null,
          position,
          quality,
        });
        if (error) throw new Error(error.message);
      } else {
        // The cover changed or the photos were ranked: positions move.
        const { error } = await db.from("product_images").update({ position, quality }).eq("id", img.id);
        if (error) throw new Error(error.message);
      }
      s.photos.set(img.id, position);
      if (quality) s.scored.add(img.id);
    }
    const kept = new Set(photos.map((i) => i.id));
    const gone = [...s.photos.keys()].filter((id) => !kept.has(id));
    if (gone.length) {
      const { error } = await db.from("product_images").delete().in("id", gone);
      if (error) throw new Error(error.message);
      gone.forEach((id) => s.photos.delete(id));
    }
  }

  async function run(id: string) {
    running.add(id);
    try {
      for (let p = waiting.get(id); p; p = waiting.get(id)) {
        waiting.delete(id);
        try {
          await save(p);
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      running.delete(id);
    }
  }

  return {
    // Resolves once everything queued is saved (or after 15 s), so a screen can show it then.
    async flush() {
      const until = Date.now() + 15_000;
      while ((waiting.size || running.size) && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    },
    // Called with the session's products after each change; only changed ones are saved.
    push(products: Product[]) {
      for (const p of products) {
        if (!worthSaving(p)) continue;
        waiting.set(p.id, p);
        if (!running.has(p.id)) void run(p.id);
      }
    },
  };
}
