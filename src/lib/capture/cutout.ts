// Keyframe -> SAM mask (through /api/segment) -> transparent product cutout, all composited
// in the browser so the Worker never touches pixels.

import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import type { Box } from "./detector";
import { signature, type Signature } from "./similarity";

const MAX_SIDE = 1024;

// `point` (a tap) marks the product inside `box`; `box` also frames the instant crop.
export type Keyframe = { canvas: HTMLCanvasElement; box: Box; point?: { x: number; y: number }; at: number };

// Copies the current video frame (downscaled) and maps the detector box onto it.
export function grabKeyframe(video: HTMLVideoElement, box: Box, point?: { x: number; y: number }): Keyframe {
  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return {
    canvas,
    box: { x: box.x * scale, y: box.y * scale, w: box.w * scale, h: box.h * scale },
    point: point && { x: point.x * scale, y: point.y * scale },
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

// `url`: the product on white with a soft shadow (what the shop shows by default).
// `cutoutUrl`: the transparent cutout itself, kept for studio photos.
export type Cutout = { url: string; cutoutUrl: string; color: string | null; samMs: number; sig: Signature };

export class SegmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Rect = { left: number; top: number; right: number; bottom: number };

// Tap candidates: the point alone (good for a small product), then square boxes around it
// of growing size. A point alone may return just the label; a box too big returns the wall.
function tapCandidates(k: Keyframe): (Rect | null)[] {
  const { x, y } = k.point!;
  const side = Math.min(k.canvas.width, k.canvas.height);
  return [
    null,
    ...[0.25, 0.35, 0.55, 0.8].map((f) => {
      const h = (side * f) / 2;
      return {
        left: Math.max(0, x - h),
        top: Math.max(0, y - h),
        right: Math.min(k.canvas.width, x + h),
        bottom: Math.min(k.canvas.height, y + h),
      };
    }),
  ];
}

// SAM rates each mask (include_confidence). Keep the most confident; when two are close,
// the smaller one, which carries less wall or table. Tested on a label tap: the point alone
// gave the label (0.62), the small box the whole bottle (0.95), the big box the wall.
function pickTapMask<M extends { bounds: Rect; confidence?: number }>(masks: readonly M[]) {
  const area = (m: M) => (m.bounds.right - m.bounds.left) * (m.bounds.bottom - m.bounds.top);
  const top = Math.max(...masks.map((m) => m.confidence ?? 0));
  const close = masks.filter((m) => (m.confidence ?? 0) >= top - 0.03);
  return close.sort((x, y) => area(x) - area(y))[0] ?? null;
}

// Ask muse-spark which whole product is at `point` (pixels of `frame`) and get its box, so SAM
// cuts out the bottle and not just its label. Null when it cannot tell.
export async function locateProduct(sessionId: string, frame: HTMLCanvasElement, point: { x: number; y: number }): Promise<Box | null> {
  const W = frame.width;
  const H = frame.height;
  const scale = Math.min(1, 768 / Math.max(W, H));
  const small = document.createElement("canvas");
  small.width = Math.round(W * scale);
  small.height = Math.round(H * scale);
  small.getContext("2d")!.drawImage(frame, 0, 0, small.width, small.height);
  try {
    const res = await fetch("/api/locate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        image: small.toDataURL("image/jpeg", 0.8),
        point: { x: (point.x / W) * 1000, y: (point.y / H) * 1000 },
      }),
    });
    if (!res.ok) return null;
    const { result: r } = (await res.json()) as { result: { x_min: number; y_min: number; x_max: number; y_max: number } };
    // The box must contain the tap, with a little margin so SAM sees the edges.
    const px = (point.x / W) * 1000;
    const py = (point.y / H) * 1000;
    if (px < r.x_min - 30 || px > r.x_max + 30 || py < r.y_min - 30 || py > r.y_max + 30) return null;
    const padX = (r.x_max - r.x_min) * 0.03;
    const padY = (r.y_max - r.y_min) * 0.03;
    const x = Math.max(0, ((r.x_min - padX) / 1000) * W);
    const y = Math.max(0, ((r.y_min - padY) / 1000) * H);
    return { x, y, w: Math.min(W, ((r.x_max + padX) / 1000) * W) - x, h: Math.min(H, ((r.y_max + padY) / 1000) * H) - y };
  } catch {
    return null;
  }
}

export async function segment(sessionId: string, k: Keyframe): Promise<Cutout | null> {
  const started = performance.now();
  const located = k.point ? await locateProduct(sessionId, k.canvas, k.point) : null;
  // Located: one box around the whole product. Not located: several guesses around the tap.
  const box = located ?? k.box;
  const candidates = k.point && !located ? tapCandidates(k) : undefined;
  const res = await fetch("/api/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      image: k.canvas.toDataURL("image/jpeg", 0.85),
      width: k.canvas.width,
      height: k.canvas.height,
      box: { left: box.x, top: box.y, right: box.x + box.w, bottom: box.y + box.h },
      point: k.point,
      candidates,
    }),
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new SegmentError(err.error ?? String(res.status), err.message ?? "Segmentation failed");
  }
  const result = await parseImageStream(sseEvents(res.body)).finalResult;
  const samMs = performance.now() - started;
  const masks = recordsOfKind(result.records, "mask");
  const mask = candidates ? pickTapMask(masks) : masks[0];
  if (!mask) return null;
  if (!candidates) {
    return composite(k, decodeMaskToRaster(mask.mask), mask.mask.width, mask.mask.height, mask.bounds, samMs);
  }
  // In one request SAM gives each pixel to a single object, so the smaller guesses (the label
  // under the finger) are cut out of the chosen one. Put back every mask lying inside it.
  const b = mask.bounds;
  const bw = b.right - b.left;
  const bh = b.bottom - b.top;
  const merged = new Uint8Array(bw * bh);
  const inside = (o: Rect) => o.left >= b.left - 4 && o.top >= b.top - 4 && o.right <= b.right + 4 && o.bottom <= b.bottom + 4;
  for (const m of masks) {
    if (m !== mask && !inside(m.bounds)) continue;
    const r = decodeMaskToRaster(m.mask);
    const mw = m.bounds.right - m.bounds.left;
    const mh = m.bounds.bottom - m.bounds.top;
    for (let y = 0; y < mh; y++) {
      const ty = m.bounds.top + y - b.top;
      if (ty < 0 || ty >= bh) continue;
      const ry = Math.min(m.mask.height - 1, Math.floor((y * m.mask.height) / mh));
      for (let x = 0; x < mw; x++) {
        const tx = m.bounds.left + x - b.left;
        if (tx < 0 || tx >= bw) continue;
        if (r[ry * m.mask.width + Math.min(m.mask.width - 1, Math.floor((x * m.mask.width) / mw))]) merged[ty * bw + tx] = 1;
      }
    }
  }
  return composite(k, merged, bw, bh, b, samMs);
}

export async function* sseEvents(body: ReadableStream<Uint8Array>) {
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
  const sig = signature(out, { x: 0, y: 0, w: bw, h: bh }, true);
  const [png, white] = await Promise.all([toBlob(out, "image/png"), toBlob(onWhite(out), "image/jpeg", 0.9)]);
  return {
    url: URL.createObjectURL(white),
    cutoutUrl: URL.createObjectURL(png),
    color: n ? colorName(r / n, g / n, b / n) : null,
    samMs,
    sig,
  };
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality),
  );
}

// Square white canvas, product centered a little high, soft contact shadow under it.
export function onWhite(cut: HTMLCanvasElement | HTMLImageElement, side = 1024) {
  const cw = cut.width;
  const ch = cut.height;
  const c = document.createElement("canvas");
  c.width = side;
  c.height = side;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, side, side);
  const scale = Math.min((side * 0.78) / cw, (side * 0.78) / ch);
  const w = cw * scale;
  const h = ch * scale;
  const x = (side - w) / 2;
  const y = (side - h) / 2 - side * 0.03;
  // Shadow: a flat blurred ellipse where the product touches the ground.
  const sy = y + h;
  const g = ctx.createRadialGradient(side / 2, sy, 0, side / 2, sy, w * 0.55);
  g.addColorStop(0, "rgba(0,0,0,0.22)");
  g.addColorStop(0.55, "rgba(0,0,0,0.08)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.translate(side / 2, sy);
  ctx.scale(1, 0.12);
  ctx.translate(-side / 2, -sy);
  ctx.fillStyle = g;
  ctx.fillRect(side / 2 - w * 0.6, sy - w * 0.6, w * 1.2, w * 1.2);
  ctx.restore();
  ctx.drawImage(cut, x, y, w, h);
  return c;
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
