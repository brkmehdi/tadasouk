// What the stock camera looks at between AI calls: a 40 pixel wide grey copy of the picture, a
// few times a second (cheap enough to run all day). It learns the empty counter, and fires once
// when the picture has been steady for about a second with something new in the middle. The same
// scene never fires twice: the item must leave (the counter looks empty again) or change first.
// SceneTrigger (src/lib/capture/scene.ts) does the same for filming, without the empty counter.

const SIZE = 40;
const STILL = 0.035; // mean change between two looks (0..1) under which the picture is steady
const DIFF = 0.1; // a pixel this much brighter or darker than before has changed
const NEW = 0.06; // share of the middle that changed: something is there
const BASE_MS = 600; // steady this long at the start: this is the empty counter
const DRIFT_MS = 4000; // the empty counter steady this long: take it again (the light moves)

type Gray = Float32Array;

export class CounterWatch {
  private canvas: HTMLCanvasElement | null = null;
  private prev: Gray | null = null;
  private base: Gray | null = null;
  private sent: Gray | null = null;
  private since = 0;
  private w = SIZE;
  private h = SIZE;
  last: Gray | null = null;
  steady = false;
  busy = false; // something new is there and the hold has started

  constructor(private holdMs = 1000) {}

  // True once, when a new steady scene is ready to be sent. `last` holds that scene.
  update(video: HTMLVideoElement, now: number): boolean {
    const g = this.look(video);
    if (!g) return false;
    const motion = this.prev ? meanDiff(g, this.prev) : 1;
    this.prev = g;
    this.last = g;
    this.busy = false;
    if (motion > STILL) {
      this.since = now;
      this.steady = false;
      return false;
    }
    this.steady = true;
    const held = now - this.since;
    if (!this.base) {
      if (held >= BASE_MS) this.base = g;
      return false;
    }
    if (this.changed(g, this.base) < NEW) {
      this.sent = null; // the counter is empty again: the next item counts
      if (held >= DRIFT_MS) {
        this.base = g;
        this.since = now;
      }
      return false;
    }
    if (this.sent && this.changed(g, this.sent) < NEW) return false;
    this.busy = true;
    if (held >= this.holdMs) {
      this.sent = g;
      this.busy = false;
      return true;
    }
    return false;
  }

  progress(now: number) {
    return this.busy ? Math.min(1, (now - this.since) / this.holdMs) : 0;
  }

  // The current scene was counted another way (a barcode): do not send it.
  markSent() {
    if (this.last) this.sent = this.last;
  }

  // The AI saw nothing on the counter: this is what empty looks like now.
  markEmpty(g: Gray | null) {
    if (g) this.base = g;
    this.sent = null;
  }

  // The camera restarted (or the phone moved): learn the counter again.
  reset() {
    this.prev = this.base = this.sent = this.last = null;
    this.steady = this.busy = false;
  }

  // Share of the middle (the central 70%) that changed between two looks.
  private changed(a: Gray, b: Gray) {
    let n = 0;
    let hit = 0;
    const { w, h } = this;
    for (let y = Math.floor(h * 0.15); y < Math.ceil(h * 0.85); y++)
      for (let x = Math.floor(w * 0.15); x < Math.ceil(w * 0.85); x++) {
        const i = y * w + x;
        n++;
        if (Math.abs(a[i] - b[i]) > DIFF) hit++;
      }
    return hit / (n || 1);
  }

  // Grey levels with the mean taken out, so the camera's exposure changes do not count as change.
  private look(video: HTMLVideoElement): Gray | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const w = SIZE;
    const h = Math.max(8, Math.round((SIZE * vh) / vw));
    this.canvas ??= document.createElement("canvas");
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.reset();
    }
    this.w = w;
    this.h = h;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0; i < g.length; i++) {
      g[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
      sum += g[i];
    }
    const mean = sum / g.length;
    for (let i = 0; i < g.length; i++) g[i] -= mean;
    return g;
  }
}

function meanDiff(a: Gray, b: Gray) {
  if (a.length !== b.length) return 1;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

// The frame sent to the AI: at most 1024 px on its long side, as a JPEG small enough for the route.
export function frameJpeg(video: HTMLVideoElement, maxBytes: number) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const s = Math.min(1, 1024 / Math.max(vw, vh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * s);
  canvas.height = Math.round(vh * s);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  let url = "";
  for (const q of [0.82, 0.68, 0.5]) {
    url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= maxBytes) break;
  }
  return url.length <= maxBytes ? url : null;
}
