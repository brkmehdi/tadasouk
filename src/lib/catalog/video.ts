// Products from a sales video the merchant uploads. Everything heavy stays on the phone: the
// file is never uploaded. The products are found the way the camera finds them (scanProducts);
// the sound, cut into short clips for /api/transcribe, and one picture of 12 frames for
// /api/extract, give their names and prices.

import { readShot } from "@/lib/capture/barcode";
import type { Keyframe } from "@/lib/capture/cutout";
import { catalogProduct, toJpeg } from "@/lib/capture/product-actions";
import { SceneTrigger } from "@/lib/capture/scene";
import { sharpness as sharpnessOf } from "@/lib/capture/shots";
import { innerRegion, SAME_CROP, SAME_SHOT, signature, similarity, type Signature } from "@/lib/capture/similarity";
import { toWav } from "@/lib/capture/voice";

export const MAX_SECONDS = 600;
export const MAX_BYTES = 300_000_000;
const RATE = 16_000;
const CLIP_SECONDS = 25; // /api/transcribe takes 30 s at most
const SILENT = 0.004; // a quieter clip is not sent
const TOGETHER = 3; // clips sent at once
const SHEET_FRAMES = 12;
const SEEK_TIMEOUT_MS = 4000;
const FRAME_SIDE = 1280; // of each product's frame, kept in memory during the review

export type Spoken = { at: number; text: string };
export type Found = { name: string; price: number | null; at: number };

// The sound at 16 kHz, or null for a video that has none.
async function soundOf(file: Blob) {
  try {
    const decoded = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await file.arrayBuffer());
    return decoded.getChannelData(0);
  } catch {
    return null;
  }
}

async function transcribe(sessionId: string, clip: Float32Array) {
  const res = await fetch(`/api/transcribe?sessionId=${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: toWav([clip]),
  });
  const data = (await res.json().catch(() => ({}))) as { transcript?: string; message?: string };
  if (!res.ok) throw new Error(data.message ?? "Transcription failed");
  return (data.transcript ?? "").trim();
}

// What is said in the video, with the second each part starts at. Only clips with sound are sent.
export async function listen(sessionId: string, file: Blob, onProgress: (done: number) => void, stopped: () => boolean): Promise<Spoken[]> {
  const sound = await soundOf(file);
  if (!sound) return [];
  const size = CLIP_SECONDS * RATE;
  const clips: { at: number; clip: Float32Array }[] = [];
  for (let start = 0; start < sound.length; start += size) {
    const clip = sound.subarray(start, start + size);
    let sum = 0;
    for (let i = 0; i < clip.length; i++) sum += clip[i] * clip[i];
    if (Math.sqrt(sum / clip.length) > SILENT) clips.push({ at: start / RATE, clip });
  }
  const spoken: Spoken[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < clips.length && !stopped()) {
      const { at, clip } = clips[next++];
      const text = await transcribe(sessionId, clip).catch(() => ""); // a lost clip costs a few words, not the video
      if (text) spoken.push({ at, text });
      onProgress(++done / clips.length);
    }
  };
  await Promise.all(Array.from({ length: TOGETHER }, worker));
  return spoken.sort((a, b) => a.at - b.at);
}

export function seek(video: HTMLVideoElement, at: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", done);
      resolve();
    };
    const timer = setTimeout(done, SEEK_TIMEOUT_MS); // a failed seek never says so
    video.addEventListener("seeked", done);
    video.currentTime = Math.max(0, Math.min(at, video.duration - 0.05));
  });
}

// 12 frames in one picture, each with its second in a corner, so one image shows the whole video.
export async function contactSheet(video: HTMLVideoElement) {
  const COLS = 4;
  const side = 280;
  const w = video.videoWidth >= video.videoHeight ? side : Math.round((side * video.videoWidth) / video.videoHeight);
  const h = video.videoWidth >= video.videoHeight ? Math.round((side * video.videoHeight) / video.videoWidth) : side;
  const canvas = document.createElement("canvas");
  canvas.width = COLS * w;
  canvas.height = Math.ceil(SHEET_FRAMES / COLS) * h;
  const g = canvas.getContext("2d")!;
  for (let i = 0; i < SHEET_FRAMES; i++) {
    const at = (video.duration * (i + 0.5)) / SHEET_FRAMES;
    await seek(video, at);
    const x = (i % COLS) * w;
    const y = Math.floor(i / COLS) * h;
    g.drawImage(video, x, y, w, h);
    g.fillStyle = "#000";
    g.fillRect(x, y, 64, 26);
    g.fillStyle = "#fff";
    g.font = "bold 20px Arial, sans-serif";
    g.fillText(`${Math.round(at)}s`, x + 5, y + 20);
  }
  return canvas.toDataURL("image/jpeg", 0.75);
}

// Edge strength of a small copy of the frame: the sharper the frame, the higher.
function sharpness(video: HTMLVideoElement, scratch: HTMLCanvasElement) {
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, scratch.width, scratch.height);
  const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
  let sum = 0;
  for (let i = 4; i < data.length; i += 4) sum += Math.abs(data[i + 1] - data[i - 3]);
  return sum;
}

// The frame on screen, smaller when the video is large: a phone cannot hold 12 frames of 4K.
export function productFrame(video: HTMLVideoElement): Keyframe {
  const s = Math.min(1, FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * s);
  canvas.height = Math.round(video.videoHeight * s);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  const side = Math.min(canvas.width, canvas.height) * 0.55;
  const center = { x: canvas.width / 2, y: canvas.height / 2 };
  return { canvas, box: { x: center.x - side / 2, y: center.y - side / 2, w: side, h: side }, point: center, at: performance.now() };
}

// The camera's own auto-capture, run over a video as if it were the camera: each moment the phone
// was held still on something becomes a shot (SceneTrigger), and shots that look alike, as the
// camera judges it (SAME_CROP), are one product, with its sharpest different views.
export type Scanned = { frame: Keyframe; views: Keyframe[]; from: number; to: number };
const SCAN_STEP = 0.25; // seconds between two looks, as often as the camera looks
const MAX_VIEWS = 3; // per product, like the shots before "+"
const MAX_SCANNED = 12; // products of one video, as many as the speech may name

export async function scanProducts(video: HTMLVideoElement, onProgress: (done: number) => void, stopped: () => boolean): Promise<Scanned[]> {
  const trigger = new SceneTrigger();
  type Shot = { k: Keyframe; sig: Signature; sharp: number; at: number };
  const products: Shot[][] = [];
  for (let at = 0; at < video.duration; at += SCAN_STEP) {
    if (stopped()) return [];
    await seek(video, at);
    onProgress(at / video.duration);
    if (!trigger.update(video, at * 1000)) continue;
    const k = productFrame(video);
    const shot = { k, sig: signature(k.canvas, innerRegion(k.box)), sharp: sharpnessOf(k), at };
    const best = products
      .map((shots) => ({ shots, score: Math.max(...shots.map((s) => similarity(s.sig, shot.sig))) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < SAME_CROP) {
      if (products.length < MAX_SCANNED) products.push([shot]);
      continue;
    }
    // The same angle again: only the sharper stays. Otherwise a new view, the sharpest ones kept.
    const twin = best.shots.findIndex((s) => similarity(s.sig, shot.sig) >= SAME_SHOT);
    if (twin >= 0) {
      if (shot.sharp > best.shots[twin].sharp) best.shots[twin] = shot;
    } else {
      best.shots.push(shot);
      best.shots.sort((a, b) => b.sharp - a.sharp).splice(MAX_VIEWS);
    }
  }
  return products.map((shots) => {
    const [first, ...rest] = [...shots].sort((a, b) => b.sharp - a.sharp);
    return { frame: first.k, views: rest.map((s) => s.k), from: Math.min(...shots.map((s) => s.at)), to: Math.max(...shots.map((s) => s.at)) };
  });
}

// What /api/video-products answers: which photos (numbered from 1) show one product.
export type VideoProduct = { photos: number[]; name_fr: string; for_sale: boolean; pack_fr: string };

// `pack`: the name of the pack the product is sold in, the same for all its items; "" when sold alone.
export type Recognised = Scanned & { code: string | null; name: string; sure: boolean; pack: string };

// The products found are named the way the camera names one after "+": by a barcode when one can
// be read (the catalog then knows it exactly), else by the AI. The AI looks at all of them at once
// (/api/video-products), so the same product filmed twice becomes one product with one name.
// A name's words, in any order, without accents or case; "1,3 L" and "1,3L" alike.
function nameKey(name: string) {
  const words = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/(\d)\s+(l|ml|cl|g|kg|mah|w|cm|mm)\b/g, "$1$2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return [...new Set(words)].sort().join(" ");
}

// The same product named twice: the same words, or one name inside the other when it says enough
// ("Poudre libre Kiko" and "Poudre libre transparente Kiko").
export function sameName(a: string, b: string) {
  const [x, y] = [nameKey(a), nameKey(b)].map((k) => (k ? k.split(" ") : []));
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (!short.length) return false;
  return short.join(" ") === long.join(" ") || (short.length >= 3 && short.every((w) => long.includes(w)));
}

export async function recognise(sessionId: string, scanned: Scanned[], spoken: Spoken[]): Promise<Recognised[]> {
  if (!scanned.length) return [];
  const codes = await Promise.all(
    scanned.map(async (s) => {
      for (const k of [s.frame, ...s.views]) {
        const code = await readShot(k).catch(() => null);
        if (code) return code;
      }
      return null;
    }),
  );
  const res = await fetch("/api/video-products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      photos: await Promise.all(scanned.map((s) => toJpeg(s.frame.canvas.toDataURL("image/jpeg", 0.85), 512))),
      moments: scanned.map((s) => s.from),
      spoken,
    }),
  }).catch(() => null);
  const groups = res?.ok ? ((await res.json()) as { products: VideoProduct[] }).products : [];
  // Photo i belongs to group[i]; the same barcode joins two groups too.
  const group = scanned.map((_, i) => groups.findIndex((g) => g.photos.includes(i + 1)));
  scanned.forEach((_, i) => {
    const twin = codes[i] ? codes.findIndex((c) => c === codes[i]) : -1;
    if (twin >= 0 && twin < i) group[i] = group[twin] >= 0 ? group[twin] : group[i];
  });

  const products: Recognised[] = [];
  const byGroup = new Map<number, Recognised>();
  for (const [i, s] of scanned.entries()) {
    const g = group[i] >= 0 ? groups[group[i]] : null;
    // The AI sometimes gives one product the same name twice and still keeps two: that is one product.
    const named = g?.for_sale ? products.find((p) => p.sure && sameName(p.name, g.name_fr)) : undefined;
    const into = (group[i] >= 0 ? byGroup.get(group[i]) : undefined) ?? named;
    if (named && group[i] >= 0) byGroup.set(group[i], named);
    if (!into) {
      const r = { ...s, code: codes[i], name: g?.name_fr ?? "", sure: !!g?.for_sale, pack: g?.for_sale ? g.pack_fr.trim() : "" };
      products.push(r);
      if (group[i] >= 0) byGroup.set(group[i], r);
      continue;
    }
    const frames = [into.frame, ...into.views, s.frame, ...s.views].sort((x, y) => sharpnessOf(y) - sharpnessOf(x)).slice(0, 3);
    Object.assign(into, {
      frame: frames[0],
      views: frames.slice(1),
      from: Math.min(into.from, s.from),
      to: Math.max(into.to, s.to),
      code: into.code ?? codes[i],
      pack: into.pack || (g?.for_sale ? g.pack_fr.trim() : ""),
    });
  }
  // A barcode the catalog knows gives the exact name.
  await Promise.all(
    products.map(async (r) => {
      const known = r.code ? await catalogProduct(r.code).catch(() => null) : null;
      if (known) Object.assign(r, { name: [known.brand, known.name, known.quantity].filter(Boolean).join(" "), sure: true });
    }),
  );
  return products;
}

// A video blurs when the hand moves: of the moments around `at`, stops on the sharpest.
export async function sharpestFrame(video: HTMLVideoElement, at: number) {
  const scratch = document.createElement("canvas");
  scratch.width = 240;
  scratch.height = Math.max(1, Math.round((240 * video.videoHeight) / video.videoWidth));
  let best = at;
  let top = -1;
  for (const t of [at - 1, at - 0.5, at, at + 0.5, at + 1]) {
    await seek(video, t);
    const s = sharpness(video, scratch);
    if (s > top) {
      top = s;
      best = t;
    }
  }
  await seek(video, best);
}
