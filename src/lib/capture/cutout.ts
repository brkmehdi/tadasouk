// Keyframe -> SAM mask (through /api/segment) -> transparent product cutout, all composited
// in the browser so the Worker never touches pixels.

import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import type { Box } from "./detector";

const MAX_SIDE = 1024;

export type Keyframe = { canvas: HTMLCanvasElement; box: Box; at: number };

// Copies the current video frame (downscaled) and maps the detector box onto it.
export function grabKeyframe(video: HTMLVideoElement, box: Box): Keyframe {
  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return {
    canvas,
    box: { x: box.x * scale, y: box.y * scale, w: box.w * scale, h: box.h * scale },
    at: performance.now(),
  };
}

// Padded crop shown on the card the instant the capture fires, before SAM answers.
export function ghostCrop(k: Keyframe): string {
  const pad = 0.08;
  const x = Math.max(0, k.box.x - k.box.w * pad);
  const y = Math.max(0, k.box.y - k.box.h * pad);
  const w = Math.min(k.canvas.width - x, k.box.w * (1 + 2 * pad));
  const h = Math.min(k.canvas.height - y, k.box.h * (1 + 2 * pad));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  c.getContext("2d")!.drawImage(k.canvas, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

export type Cutout = { url: string; blob: Blob; color: string | null; samMs: number };

export class SegmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function segment(sessionId: string, k: Keyframe): Promise<Cutout | null> {
  const started = performance.now();
  const res = await fetch("/api/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      image: k.canvas.toDataURL("image/jpeg", 0.85),
      width: k.canvas.width,
      height: k.canvas.height,
      box: { left: k.box.x, top: k.box.y, right: k.box.x + k.box.w, bottom: k.box.y + k.box.h },
    }),
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new SegmentError(err.error ?? String(res.status), err.message ?? "Segmentation failed");
  }
  const result = await parseImageStream(sseEvents(res.body)).finalResult;
  const samMs = performance.now() - started;
  const mask = recordsOfKind(result.records, "mask")[0];
  if (!mask) return null;
  const raster = decodeMaskToRaster(mask.mask);
  return composite(k, raster, mask.mask.width, mask.mask.height, mask.bounds, samMs);
}

async function* sseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      yield JSON.parse(data) as { type: string };
    }
  }
}

async function composite(
  k: Keyframe,
  raster: Uint8Array,
  rw: number,
  rh: number,
  bounds: { left: number; top: number; right: number; bottom: number },
  samMs: number,
): Promise<Cutout> {
  const bw = Math.max(1, bounds.right - bounds.left);
  const bh = Math.max(1, bounds.bottom - bounds.top);
  const out = document.createElement("canvas");
  out.width = bw;
  out.height = bh;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(k.canvas, bounds.left, bounds.top, bw, bh, 0, 0, bw, bh);
  const img = ctx.getImageData(0, 0, bw, bh);
  const px = img.data;
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = 0; y < bh; y++) {
    const ry = Math.min(rh - 1, Math.floor((y * rh) / bh));
    for (let x = 0; x < bw; x++) {
      const rx = Math.min(rw - 1, Math.floor((x * rw) / bw));
      const i = (y * bw + x) * 4;
      if (raster[ry * rw + rx]) {
        if ((x + y) % 3 === 0) {
          r += px[i];
          g += px[i + 1];
          b += px[i + 2];
          n++;
        }
      } else {
        px[i + 3] = 0;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    out.toBlob((bl) => (bl ? resolve(bl) : reject(new Error("toBlob failed"))), "image/png"),
  );
  return {
    url: URL.createObjectURL(blob),
    blob,
    color: n ? colorName(r / n, g / n, b / n) : null,
    samMs,
  };
}

// Coarse color word for references like "the red one".
function colorName(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 510;
  const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  if (l < 0.18) return "black";
  if (l > 0.85 && s < 0.3) return "white";
  if (s < 0.18) return "gray";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 340) return l < 0.35 ? "brown" : "red";
  if (h < 40) return l < 0.4 ? "brown" : "orange";
  if (h < 70) return "yellow";
  if (h < 165) return "green";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}
