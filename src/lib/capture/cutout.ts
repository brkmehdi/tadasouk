// Keyframe -> SAM mask (through /api/segment) -> transparent product cutout, all composited
// in the browser so the Worker never touches pixels.

import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import type { Box } from "./detector";
import { signature, type Signature } from "./similarity";

const SAM_SIDE = 1024; // the picture SAM gets
const OUT_SIDE = 1600; // the cutout kept, when the camera gave more pixels than SAM needs
const MAX_ENLARGE = 2; // SAM's mask is coarser than its picture, so a small product goes in enlarged
const MARGIN = 0.18; // room kept around the product's box

// `point` (a tap) marks the product inside `box`; `box` also frames the instant crop.
// `still`: a real photo taken at the same moment, when the phone can take one.
export type Keyframe = {
  canvas: HTMLCanvasElement;
  box: Box;
  point?: { x: number; y: number };
  at: number;
  still?: Promise<HTMLCanvasElement | null> | null;
};

// Copies the current video frame at full size; coordinates are video pixels.
export function grabKeyframe(video: HTMLVideoElement, box: Box, point?: { x: number; y: number }): Keyframe {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { canvas, box, point, at: performance.now() };
}

// What SAM looks at: only the area around the product when its box is known, so the product
// fills the picture and the mask, and `full`, the same area with all the pixels we have.
function viewOf(k: Keyframe, still: HTMLCanvasElement | null, box: Box | null) {
  const src = still ?? k.canvas;
  const r = src.width / k.canvas.width;
  const W = k.canvas.width;
  const H = k.canvas.height;
  const x = box ? Math.max(0, box.x - box.w * MARGIN) : 0;
  const y = box ? Math.max(0, box.y - box.h * MARGIN) : 0;
  const w = box ? Math.min(W, box.x + box.w * (1 + MARGIN)) - x : W;
  const h = box ? Math.min(H, box.y + box.h * (1 + MARGIN)) - y : H;
  const side = Math.max(w, h);
  const s = Math.min(SAM_SIDE / side, MAX_ENLARGE * r);
  const o = Math.max(s, Math.min(r, OUT_SIDE / side));
  const drawn = (scale: number) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, x * r, y * r, w * r, h * r, 0, 0, c.width, c.height);
    return c;
  };
  const picture = drawn(s);
  return {
    picture,
    full: o > s ? drawn(o) : picture,
    at: (px: number, py: number) => ({ x: (px - x) * s, y: (py - y) * s }),
  };
}

// `url`: the product on white with a soft shadow.
export type Cutout = { url: string; color: string | null; samMs: number; sig: Signature };

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
export async function locateProduct(
  sessionId: string,
  frame: HTMLCanvasElement,
  point: { x: number; y: number },
  mode: "tap" | "held" = "tap",
): Promise<(Box & { noun: string }) | null> {
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
        mode,
      }),
    });
    if (!res.ok) return null;
    const { result: r } = (await res.json()) as {
      result: { found: boolean; noun: string; x_min: number; y_min: number; x_max: number; y_max: number };
    };
    if (!r.found) return null;
    // The box must contain the tap, with a little margin so SAM sees the edges.
    const px = (point.x / W) * 1000;
    const py = (point.y / H) * 1000;
    if (px < r.x_min - 30 || px > r.x_max + 30 || py < r.y_min - 30 || py > r.y_max + 30) return null;
    const padX = (r.x_max - r.x_min) * 0.03;
    const padY = (r.y_max - r.y_min) * 0.03;
    const x = Math.max(0, ((r.x_min - padX) / 1000) * W);
    const y = Math.max(0, ((r.y_min - padY) / 1000) * H);
    return { x, y, w: Math.min(W, ((r.x_max + padX) / 1000) * W) - x, h: Math.min(H, ((r.y_max + padY) / 1000) * H) - y, noun: r.noun };
  } catch {
    return null;
  }
}

export async function segment(sessionId: string, k: Keyframe): Promise<Cutout | null> {
  const started = performance.now();
  const [located, still] = await Promise.all([
    k.point ? locateProduct(sessionId, k.canvas, k.point) : null,
    k.still ?? null,
  ]);
  // Located: one box around the whole product. Not located: several guesses around the tap,
  // on the whole picture.
  const box = located ?? k.box;
  const tap = k.point && !located ? tapCandidates(k) : undefined;
  const view = viewOf(k, still, tap ? null : box);
  const corners = (b: Rect) => {
    const a = view.at(b.left, b.top);
    const z = view.at(b.right, b.bottom);
    return { left: a.x, top: a.y, right: z.x, bottom: z.y };
  };
  const candidates = tap?.map((c) => c && corners(c));
  const res = await fetch("/api/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      image: view.picture.toDataURL("image/jpeg", 0.9),
      width: view.picture.width,
      height: view.picture.height,
      box: corners({ left: box.x, top: box.y, right: box.x + box.w, bottom: box.y + box.h }),
      point: k.point && view.at(k.point.x, k.point.y),
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
    return composite(view, decodeMaskToRaster(mask.mask), mask.mask.width, mask.mask.height, mask.bounds, samMs);
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
  return composite(view, merged, bw, bh, b, samMs);
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

// SAM's mask is on or off and coarser than the photo: alone it gives stairs on the edges, specks
// around the product and small holes in it. This keeps the product's main pieces, fills small
// holes (a large one may be a real opening, like a handle) and gives the edge a clean soft line.
function eachPiece(m: Uint8Array, w: number, h: number, value: number, visit: (cells: number[], edge: boolean) => void) {
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) {
    if (seen[i] || m[i] !== value) continue;
    const cells = [i];
    seen[i] = 1;
    let edge = false;
    const add = (q: number) => {
      if (!seen[q] && m[q] === value) {
        seen[q] = 1;
        cells.push(q);
      }
    };
    for (let c = 0; c < cells.length; c++) {
      const p = cells[c];
      const x = p % w;
      const y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      if (x > 0) add(p - 1);
      if (x < w - 1) add(p + 1);
      if (y > 0) add(p - w);
      if (y < h - 1) add(p + w);
    }
    visit(cells, edge);
  }
}

function cleanMask(raster: Uint8Array, w: number, h: number) {
  const pieces: number[][] = [];
  eachPiece(raster, w, h, 1, (cells) => pieces.push(cells));
  const largest = Math.max(0, ...pieces.map((p) => p.length));
  const out = new Uint8Array(w * h);
  for (const piece of pieces) {
    if (piece.length < largest * 0.15) continue;
    for (const i of piece) out[i] = 1;
  }
  eachPiece(out, w, h, 0, (cells, edge) => {
    if (edge || cells.length > largest * 0.015) return;
    for (const i of cells) out[i] = 1;
  });
  return out;
}

function softAlpha(mask: Uint8Array, rw: number, rh: number, bw: number, bh: number) {
  const a = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const fy = Math.max(0, Math.min(rh - 1, ((y + 0.5) * rh) / bh - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(rh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < bw; x++) {
      const fx = Math.max(0, Math.min(rw - 1, ((x + 0.5) * rw) / bw - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(rw - 1, x0 + 1);
      const tx = fx - x0;
      const top = mask[y0 * rw + x0] * (1 - tx) + mask[y0 * rw + x1] * tx;
      const low = mask[y1 * rw + x0] * (1 - tx) + mask[y1 * rw + x1] * tx;
      a[y * bw + x] = top * (1 - ty) + low * ty;
    }
  }
  const radius = Math.max(1, Math.round(Math.max(bw, bh) / 400));
  const blurLine = (start: number, step: number, n: number, line: Float32Array) => {
    let sum = 0;
    for (let i = 0; i < n; i++) line[i] = a[start + i * step];
    for (let i = -radius; i <= radius; i++) sum += line[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < n; i++) {
      a[start + i * step] = sum / (2 * radius + 1);
      sum += line[Math.min(n - 1, i + radius + 1)] - line[Math.max(0, i - radius)];
    }
  };
  const row = new Float32Array(bw);
  const col = new Float32Array(bh);
  for (let y = 0; y < bh; y++) blurLine(y * bw, 1, bw, row);
  for (let x = 0; x < bw; x++) blurLine(x, bw, bh, col);
  // Past the middle of the blur, so the line sits just inside the product and leaves no halo.
  for (let i = 0; i < a.length; i++) a[i] = Math.max(0, Math.min(1, (a[i] - 0.55) * 3 + 0.5));
  return a;
}

async function composite(
  view: { picture: HTMLCanvasElement; full: HTMLCanvasElement },
  raster: Uint8Array,
  rw: number,
  rh: number,
  bounds: { left: number; top: number; right: number; bottom: number },
  samMs: number,
): Promise<Cutout> {
  const f = view.full.width / view.picture.width;
  const left = Math.round(bounds.left * f);
  const top = Math.round(bounds.top * f);
  const bw = Math.max(1, Math.round((bounds.right - bounds.left) * f));
  const bh = Math.max(1, Math.round((bounds.bottom - bounds.top) * f));
  const out = document.createElement("canvas");
  out.width = bw;
  out.height = bh;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(view.full, left, top, bw, bh, 0, 0, bw, bh);
  const img = ctx.getImageData(0, 0, bw, bh);
  const px = img.data;
  const alpha = softAlpha(cleanMask(raster, rw, rh), rw, rh, bw, bh);
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const k = y * bw + x;
      const i = k * 4;
      if (alpha[k] > 0.9 && (x + y) % 3 === 0) {
        r += px[i];
        g += px[i + 1];
        b += px[i + 2];
        n++;
      }
      px[i + 3] = alpha[k] * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const sig = signature(out, { x: 0, y: 0, w: bw, h: bh }, true);
  const white = await toBlob(onWhite(out), "image/jpeg", 0.9);
  return {
    url: URL.createObjectURL(white),
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
  ctx.imageSmoothingQuality = "high";
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
