// Browser side of the two slow product actions: AI studio photos and the price check.

import { sseEvents } from "./cutout";
import { cover, type PriceCheck, type Product } from "./session";

// Flattens any product image (transparent PNG cutout, blob or data URL) onto white as a JPEG.
export async function toJpeg(url: string, maxSide: number): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
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

// Returns object URLs of the generated photos, as each one arrives.
export async function betterPhotos(sessionId: string, p: Product, onPhoto: (url: string) => void) {
  const src = cover(p);
  if (!src) throw new Error("Pas encore de photo");
  const res = await fetch("/api/better-photos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, image: await toJpeg(src.url, 1024), name: p.name, label: p.label, color: p.color }),
  });
  if (!res.ok || !res.body) throw new Error(await errorMessage(res, "Photos indisponibles"));
  let count = 0;
  for await (const ev of sseEvents(res.body)) {
    const b64 = (ev as { b64_json?: string }).b64_json;
    if (!b64) continue;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    onPhoto(URL.createObjectURL(new Blob([bytes], { type: "image/webp" })));
    count++;
  }
  if (!count) throw new Error("Aucune photo générée");
}

export async function checkPrice(sessionId: string, p: Product): Promise<PriceCheck> {
  const src = cover(p);
  const res = await fetch("/api/price-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      image: src ? await toJpeg(src.url, 512) : undefined,
      name: p.name,
      label: p.label,
      description: p.description,
      price: p.price,
      currency: p.currency,
    }),
  });
  if (!res.ok) return { status: "error", message: await errorMessage(res, "Vérification impossible") };
  const { result } = (await res.json()) as { result: Omit<Extract<PriceCheck, { status: "done" }>, "status"> };
  return { status: "done", ...result };
}
