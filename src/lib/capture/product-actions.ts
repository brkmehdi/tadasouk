// Browser side of the slow product actions: naming, AI photos, web photos, price check, scores.

import { sseEvents } from "./cutout";
import { REFUSED } from "./refused";
import { type PhotoQuality, type PriceCheck, type Product, type ProductImage } from "./session";

async function loadImage(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

// Flattens any product image (transparent PNG cutout, blob or data URL) onto white as a JPEG.
export async function toJpeg(url: string, maxSide: number): Promise<string> {
  const img = await loadImage(url);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

async function errorMessage(res: Response, fallback: string) {
  const j = (await res.json().catch(() => ({}))) as { message?: string };
  return j.message ?? fallback;
}

async function post(path: string, body: unknown) {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

// The AI will not make a picture of this kind of product (tobacco, for example).
export class PhotoRefused extends Error {
  constructor() {
    super("L'IA ne crée pas de photo pour ce type de produit. Vos photos restent.");
  }
}

// Each finished image of an images SSE stream, as a blob URL.
async function* streamedImages(res: Response) {
  for await (const ev of sseEvents(res.body!)) {
    const { b64_json: b64, error } = ev as { b64_json?: string; error?: { code?: string } };
    if (error?.code === REFUSED) throw new PhotoRefused();
    if (!b64) continue;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    yield URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
  }
}

export type Identity = { name_fr: string; name_ar: string; category: string; description_fr: string; confident: boolean };

// The merchant's own photo. Photos from other sites cannot be drawn to a canvas and read
// back (cross-origin), so every upload to the API starts from the camera photo.
function ownPhoto(p: Product) {
  return p.images.find((i) => i.source === "camera" && !i.pending) ?? p.images.find((i) => i.source !== "web") ?? null;
}

export async function identify(sessionId: string, p: Product): Promise<Identity | null> {
  const shots = p.images.filter((i) => i.source === "camera" && !i.pending).slice(0, 3);
  const src = shots[0] ?? ownPhoto(p);
  if (!src) return null;
  const more = await Promise.all(shots.slice(1).map((i) => toJpeg(i.url, 512)));
  const res = await post("/api/identify", { sessionId, image: await toJpeg(src.url, 512), more, label: p.label });
  if (!res.ok) return null;
  return ((await res.json()) as { result: Identity }).result;
}

// One photo from another angle, guided by web references of the product (muse-image's built-in
// search). Each new request takes the next angle.
const ANGLES = [
  { key: "three_quarter", label: "3/4" },
  { key: "side", label: "Côté" },
  { key: "back", label: "Dos" },
] as const;

export async function betterPhotos(sessionId: string, p: Product, onPhoto: (url: string, angle: string) => void) {
  const src = ownPhoto(p);
  if (!src) throw new Error("Pas encore de photo");
  const angle = ANGLES[p.images.filter((i) => i.source === "ai").length % ANGLES.length];
  const res = await post("/api/better-photos", {
    sessionId,
    image: await toJpeg(src.url, 1024),
    angle: angle.key,
    name: p.name,
    label: p.label,
    color: p.color,
  });
  if (!res.ok || !res.body) throw new Error(await errorMessage(res, "Photos indisponibles"));
  let got = false;
  for await (const url of streamedImages(res)) {
    onPhoto(url, angle.label);
    got = true;
  }
  if (!got) throw new Error("Aucune photo générée");
}

// All the photos of a product in one request, the merchant's real one first: the model compares
// them with each other. The server reads the shops' photos, which the browser cannot read back.
export async function scorePhotos(sessionId: string, images: ProductImage[], name: string | null): Promise<(PhotoQuality | null)[]> {
  const photos = await Promise.all(images.map((i) => (i.source === "web" ? i.url : toJpeg(i.url, 768))));
  const res = await post("/api/photo-score", { sessionId, photos, name });
  if (!res.ok) return images.map(() => null);
  return ((await res.json()) as { results: (PhotoQuality | null)[] }).results;
}

export async function checkPrice(sessionId: string, p: Product): Promise<PriceCheck> {
  const src = ownPhoto(p);
  const res = await post("/api/price-check", {
    sessionId,
    // With the name alone the search can turn a real car into a toy of the same name.
    image: src && !src.pending ? await toJpeg(src.url, 512) : undefined,
    name: p.name,
    label: p.label,
    description: p.description,
    price: p.price,
    currency: p.currency,
    barcode: p.barcode,
  });
  if (!res.ok) return { status: "error", message: await errorMessage(res, "Vérification impossible") };
  const { result } = (await res.json()) as { result: Omit<Extract<PriceCheck, { status: "done" }>, "status"> };
  return { status: "done", ...result };
}

export type CatalogProduct = { name: string; brand: string | null; quantity: string | null; category: string; image_url: string | null; source: string };

// The photographed product in the shared catalog, confirmed by comparing photos, or null.
export async function matchCatalog(sessionId: string, p: Product): Promise<(CatalogProduct & { barcode: string }) | null> {
  const src = ownPhoto(p);
  if (!src || !p.name) return null;
  const res = await post("/api/catalog-match", { sessionId, image: await toJpeg(src.url, 512), name: p.name });
  if (!res.ok) return null;
  return ((await res.json()) as { product: (CatalogProduct & { barcode: string }) | null }).product;
}

// The product of a barcode in the shared catalog, or null.
export async function catalogProduct(barcode: string): Promise<CatalogProduct | null> {
  const res = await fetch(`/api/catalog?barcode=${encodeURIComponent(barcode)}`);
  if (!res.ok) return null;
  return ((await res.json()) as { product: CatalogProduct | null }).product;
}

export type WebPhoto = { image: string; page: string; site: string };

// Real product photos taken from the shop pages the price research found.
export async function webPhotos(sessionId: string, urls: string[]): Promise<WebPhoto[]> {
  if (!urls.length) return [];
  const res = await post("/api/web-photos", { sessionId, urls });
  if (!res.ok) return [];
  return ((await res.json()) as { photos: WebPhoto[] }).photos;
}
