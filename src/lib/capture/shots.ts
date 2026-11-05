// The photos of a product while the merchant shoots it. A shot is kept as it is: its surroundings
// help to tell what the product is, and its background may never need removing. Nothing here
// calls the AI. See finishProduct in CaptureScreen.

import type { Keyframe } from "./cutout";

const PHOTO_SIDE = 1600;
const PREVIEW_SIDE = 480;
const SHARPER = 1.1; // a near copy replaces a shot only if clearly sharper

function scaled(src: HTMLCanvasElement, side: number) {
  const s = Math.min(1, side / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// Shown at once on the card, before the real photo is ready.
export const previewOf = (k: Keyframe) => scaled(k.canvas, PREVIEW_SIDE).toDataURL("image/jpeg", 0.7);

// The photo kept: the real photo when the phone took one, else the video frame.
export async function photoOf(k: Keyframe) {
  const source = (await k.still?.catch(() => null)) ?? k.canvas;
  const blob = await new Promise<Blob>((resolve, reject) =>
    scaled(source, PHOTO_SIDE).toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.88),
  );
  return URL.createObjectURL(blob);
}

// Edge strength of a small copy: a blurred shot has soft edges.
export function sharpness(k: Keyframe) {
  const c = scaled(k.canvas, 240);
  const { data } = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  let sum = 0;
  for (let i = 4; i < data.length; i += 4) sum += Math.abs(data[i + 1] - data[i - 3]);
  return sum / (c.width * c.height);
}

export const clearlySharper = (a: Keyframe, b: Keyframe) => sharpness(a) > sharpness(b) * SHARPER;
