// Browser side of the slow product actions: naming, studio photo, web photos, price check.

import { onWhite, sseEvents } from "./cutout";
import { cover, type PriceCheck, type Product } from "./session";

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

// Each finished image of an images SSE stream, as a blob URL.
async function* streamedImages(res: Response) {
  for await (const ev of sseEvents(res.body!)) {
    const b64 = (ev as { b64_json?: string }).b64_json;
    if (!b64) continue;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    yield URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
  }
}

export type Identity = { name_fr: string; name_ar: string; category: string; description_fr: string; confident: boolean };

export async function identify(sessionId: string, p: Product): Promise<Identity | null> {
  const src = cover(p);
  if (!src) return null;
  const res = await post("/api/identify", { sessionId, image: await toJpeg(src.url, 512), label: p.label });
  if (!res.ok) return null;
  return ((await res.json()) as { result: Identity }).result;
}

// Photos guided by web references of the product (muse-image's built-in search).
export async function betterPhotos(sessionId: string, p: Product, onPhoto: (url: string) => void) {
  const src = p.images.find((i) => i.source === "camera" && !i.pending) ?? cover(p);
  if (!src) throw new Error("Pas encore de photo");
  const res = await post("/api/better-photos", {
    sessionId,
    image: await toJpeg(src.url, 1024),
    name: p.name,
    label: p.label,
    color: p.color,
  });
  if (!res.ok || !res.body) throw new Error(await errorMessage(res, "Photos indisponibles"));
  let count = 0;
  for await (const url of streamedImages(res)) {
    onPhoto(url);
    count++;
  }
  if (!count) throw new Error("Aucune photo générée");
}

// Studio backdrop around the merchant's real photo. The real cutout is pasted back on top
// of the generated image, so the product pixels are the camera's. The fidelity check compares
// the generated product area with the real one: if the model moved or redrew the product,
// the backdrop would not line up, and the photo falls back to the plain white version.
export async function studioPhoto(sessionId: string, cutoutUrl: string): Promise<{ url: string; fidelity: number }> {
  const cut = await loadImage(cutoutUrl);
  const layout = onWhite(cut); // same placement as the input sent to the model
  const transparent = document.createElement("canvas");
  transparent.width = layout.width;
  transparent.height = layout.height;
  const tctx = transparent.getContext("2d", { willReadFrequently: true })!;
  drawPlaced(tctx, cut, transparent.width);

  const res = await post("/api/studio-photo", { sessionId, image: layout.toDataURL("image/jpeg", 0.9) });
  if (!res.ok || !res.body) throw new Error(await errorMessage(res, "Photo studio indisponible"));
  let generatedUrl: string | null = null;
  for await (const url of streamedImages(res)) generatedUrl = url;
  if (!generatedUrl) throw new Error("Photo studio vide");

  const gen = await loadImage(generatedUrl);
  URL.revokeObjectURL(generatedUrl);
  const side = 1024;
  const c = document.createElement("canvas");
  c.width = side;
  c.height = side;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(gen, 0, 0, side, side);
  // The model may nudge the product a few pixels; find where it put it, and paste the real
  // product there so it sits on its painted shadow.
  const { fidelity, dx, dy } = bestAlignment(ctx.getImageData(0, 0, side, side).data, tctx.getImageData(0, 0, side, side).data, side);
  ctx.drawImage(transparent, dx, dy);
  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.9),
  );
  console.info("studio photo fidelity", fidelity.toFixed(2), "offset", dx, dy);
  if (fidelity < 0.8) throw new Error(`Photo studio refusée (fidélité ${fidelity.toFixed(2)})`);
  return { url: URL.createObjectURL(blob), fidelity };
}

// Same placement as onWhite() so the pasted cutout lands where the model saw it.
function drawPlaced(ctx: CanvasRenderingContext2D, cut: HTMLImageElement, side: number) {
  const scale = Math.min((side * 0.78) / cut.width, (side * 0.78) / cut.height);
  const w = cut.width * scale;
  const h = cut.height * scale;
  ctx.drawImage(cut, (side - w) / 2, (side - h) / 2 - side * 0.03, w, h);
}

// Share of product pixels (opaque in the cutout) whose color the generated image kept,
// sampled on a grid: 1 = the product is where it was and looks the same.
function agreement(generated: Uint8ClampedArray, cutout: Uint8ClampedArray, side: number, dx: number, dy: number) {
  let n = 0;
  let ok = 0;
  for (let i = 0; i < cutout.length; i += 4 * 7) {
    if (cutout[i + 3] < 250) continue;
    const p = i / 4;
    const x = (p % side) + dx;
    const y = Math.floor(p / side) + dy;
    if (x < 0 || y < 0 || x >= side || y >= side) continue;
    const j = (y * side + x) * 4;
    n++;
    const d = Math.abs(generated[j] - cutout[i]) + Math.abs(generated[j + 1] - cutout[i + 1]) + Math.abs(generated[j + 2] - cutout[i + 2]);
    if (d < 90) ok++;
  }
  return n ? ok / n : 0;
}

// Best agreement over small shifts (up to 24 px each way, in 4 px steps).
function bestAlignment(generated: Uint8ClampedArray, cutout: Uint8ClampedArray, side: number) {
  let best = { fidelity: -1, dx: 0, dy: 0 };
  for (let dy = -24; dy <= 24; dy += 4) {
    for (let dx = -24; dx <= 24; dx += 4) {
      const fidelity = agreement(generated, cutout, side, dx, dy);
      if (fidelity > best.fidelity) best = { fidelity, dx, dy };
    }
  }
  return best;
}

export async function checkPrice(sessionId: string, p: Product): Promise<PriceCheck> {
  const src = cover(p);
  const res = await post("/api/price-check", {
    sessionId,
    image: src && !src.pending ? await toJpeg(src.url, 512) : undefined,
    name: p.name,
    label: p.label,
    description: p.description,
    price: p.price,
    currency: p.currency,
  });
  if (!res.ok) return { status: "error", message: await errorMessage(res, "Vérification impossible") };
  const { result } = (await res.json()) as { result: Omit<Extract<PriceCheck, { status: "done" }>, "status"> };
  return { status: "done", ...result };
}
