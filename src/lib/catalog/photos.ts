"use client";

// Photos edited from the back office, after filming: add one from the phone (camera or gallery),
// remove one, choose the cover. Uploads go through /api/media into the merchant's own folder.

import { supabase } from "@/lib/supabase/browser";
import { photosOf, type CatalogProduct } from "./types";

// Phone photos are large: send at most `max` pixels on the long side, as JPEG.
export async function shrink(file: Blob, max = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the photo"))), "image/jpeg", 0.85),
  );
}

// `query` says where it goes: "product=<id>&image=<id>" or "kind=hero&image=<id>".
export async function uploadMedia(blob: Blob, query: string) {
  const res = await fetch(`/api/media?${query}`, { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
  if (!res.ok) throw new Error(`upload ${res.status}`);
  return ((await res.json()) as { key: string }).key;
}

export async function addPhoto(storeId: string, p: CatalogProduct, file: File) {
  const id = crypto.randomUUID();
  const key = await uploadMedia(await shrink(file), `product=${p.id}&image=${id}`);
  const position = Math.max(-1, ...p.product_images.map((i) => i.position)) + 1;
  const { error } = await supabase()
    .from("product_images")
    .insert({ id, product_id: p.id, store_id: storeId, r2_key: key, source: "camera", position });
  if (error) throw error;
}

export async function removePhoto(imageId: string) {
  const { error } = await supabase().from("product_images").delete().eq("id", imageId);
  if (error) throw error;
}

export async function makeCover(p: CatalogProduct, imageId: string) {
  const order = [imageId, ...photosOf(p).map((i) => i.id).filter((id) => id !== imageId)];
  const db = supabase();
  for (const [position, id] of order.entries()) {
    const { error } = await db.from("product_images").update({ position }).eq("id", id);
    if (error) throw error;
  }
}
