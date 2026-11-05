// A second auto-capture trigger, for the many products the object detector has no class for
// (tissues, chargers, sandals, tea boxes: its 80 classes are mostly not shop items). It needs no
// model: the phone held still on something (not a blank wall). The capture screen then asks
// /api/locate (mode "held") whether a product is in the middle and where, and cuts out only that.
// A first version also wanted the middle sharper than the edges; shops full of detail behind the
// product failed it, so the yes or no now comes from the model.

const SIZE = 48; // the picture is looked at 48 pixels wide: cheap enough for every look

const STILL = 0.033; // mean change between two looks (0..1) under which the phone counts as still
const MOVED = 0.09; // above this the phone was moved: the next still scene is a new one
const MIN_EDGES = 0.035; // a blank wall or table in the middle is not a product

export type SceneLook = { motion: number; center: number; border: number };

export class SceneTrigger {
  private canvas: HTMLCanvasElement | null = null;
  private prev: Float32Array | null = null;
  private since = 0;
  private holding = false;
  private lastFireAt = 0;
  private waitForMove = false;
  last: SceneLook | null = null;
  steady = false; // the picture barely changes
  moved = false; // the phone was just moved

  constructor(
    private holdMs = 1100,
    private cooldownMs = 2500,
  ) {}

  update(video: HTMLVideoElement, now: number): boolean {
    const look = this.look(video);
    if (!look) return false;
    this.moved = look.motion > MOVED;
    if (this.moved) this.waitForMove = false;
    const still = look.motion < STILL;
    this.steady = still;
    const product = look.center > MIN_EDGES;
    if (!still || !product || this.waitForMove) {
      this.since = now;
      this.holding = false;
      return false;
    }
    this.holding = true;
    if (now - this.since >= this.holdMs && now - this.lastFireAt >= this.cooldownMs) {
      this.captured(now);
      return true;
    }
    return false;
  }

  // Any capture (this one, the detector's, the shutter, the frame) means: wait for the phone to
  // move before the next one, so the same product is not taken twice.
  captured(now: number) {
    this.lastFireAt = now;
    this.waitForMove = true;
    this.holding = false;
    this.since = now;
  }

  // Another trigger is in charge (the detector sees a product in the middle).
  restart(now: number) {
    this.since = now;
    this.holding = false;
  }

  progress(now: number) {
    return this.holding ? Math.min(1, (now - this.since) / this.holdMs) : 0;
  }

  private look(video: HTMLVideoElement): SceneLook | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const w = SIZE;
    const h = Math.max(8, Math.round((SIZE * vh) / vw));
    this.canvas ??= document.createElement("canvas");
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.prev = null;
    }
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    for (let i = 0; i < g.length; i++) g[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;

    let motion = 0;
    if (this.prev) {
      for (let i = 0; i < g.length; i++) motion += Math.abs(g[i] - this.prev[i]);
      motion /= g.length;
    } else {
      motion = 1;
    }
    this.prev = g;

    // Edge strength in the middle (30%..70% of each side) against the outer ring (outside 15%..85%).
    let center = 0;
    let centerN = 0;
    let border = 0;
    let borderN = 0;
    for (let y = 1; y < h - 1; y++) {
      const fy = y / h;
      for (let x = 1; x < w - 1; x++) {
        const fx = x / w;
        const i = y * w + x;
        const e = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]);
        if (fx > 0.3 && fx < 0.7 && fy > 0.3 && fy < 0.7) {
          center += e;
          centerN++;
        } else if (fx < 0.15 || fx > 0.85 || fy < 0.15 || fy > 0.85) {
          border += e;
          borderN++;
        }
      }
    }
    this.last = { motion, center: center / (centerN || 1), border: border / (borderN || 1) };
    return this.last;
  }
}
