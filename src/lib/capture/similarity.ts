// Visual fingerprint of a captured product, so showing the same product again selects its
// card instead of creating a duplicate. Both signals are computed on a 32x32 thumbnail and
// are chosen to survive what changes between two looks at the same product on a phone:
// - color: hue histogram (16 bins, soft-assigned) plus 3 bins for grey pixels by brightness
//   relative to the frame, so a darker or warmer light shifts it little;
// - shape: 8x8 difference hash (is each cell brighter than its right neighbor), which does not
//   depend on overall brightness.
// Tested on synthetic scenes: same product moved, tilted 30°, darker or warmer light scored
// 0.72-0.88; different products 0.18-0.40, a look-alike red bottle 0.66.

export type Signature = { color: Float32Array; hash: Uint8Array };

// Above this, a capture shows a product already taken (the camera, and a video's scan).
export const SAME_CROP = 0.74;
export const SAME_SHOT = 0.93; // two shots of one product this alike show the same angle

const SIZE = 32;
const HUE_BINS = 16;
let scratch: HTMLCanvasElement | null = null;

// `useAlpha`: only count opaque pixels (a SAM cutout); otherwise the whole region.
export function signature(
  src: CanvasImageSource,
  region: { x: number; y: number; w: number; h: number },
  useAlpha = false,
): Signature {
  scratch ??= document.createElement("canvas");
  scratch.width = SIZE;
  scratch.height = SIZE;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(src, region.x, region.y, Math.max(1, region.w), Math.max(1, region.h), 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;

  const hue = new Float32Array(SIZE * SIZE).fill(-1);
  const sat = new Float32Array(SIZE * SIZE);
  const val = new Float32Array(SIZE * SIZE);
  const used = new Uint8Array(SIZE * SIZE);
  let sumV = 0;
  let n = 0;
  for (let k = 0; k < SIZE * SIZE; k++) {
    const i = k * 4;
    if (useAlpha && px[i + 3] < 128) continue;
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    if (max > min) {
      if (max === r) h = ((g - b) / (max - min)) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      h = (h * 60 + 360) % 360;
    }
    hue[k] = h;
    sat[k] = max ? (max - min) / max : 0;
    val[k] = max;
    used[k] = 1;
    sumV += max;
    n++;
  }

  const color = new Float32Array(HUE_BINS + 3);
  const meanV = sumV / (n || 1) || 1;
  for (let k = 0; k < SIZE * SIZE; k++) {
    if (!used[k]) continue;
    if (sat[k] > 0.25 && val[k] > 0.12) {
      const f = (hue[k] / 360) * HUE_BINS - 0.5;
      const i0 = Math.floor(f);
      const w = f - i0;
      color[(i0 + HUE_BINS) % HUE_BINS] += 1 - w;
      color[(i0 + 1) % HUE_BINS] += w;
    } else {
      const rv = val[k] / meanV;
      color[HUE_BINS + (rv < 0.6 ? 0 : rv < 1.2 ? 1 : 2)] += 1;
    }
  }
  for (let i = 0; i < color.length; i++) color[i] /= n || 1;

  const gray = new Float32Array(9 * 8);
  const count = new Float32Array(9 * 8);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const k = y * SIZE + x;
      if (!used[k]) continue;
      const cell = Math.floor((y * 8) / SIZE) * 9 + Math.min(8, Math.floor((x * 9) / SIZE));
      gray[cell] += 0.299 * px[k * 4] + 0.587 * px[k * 4 + 1] + 0.114 * px[k * 4 + 2];
      count[cell]++;
    }
  }
  for (let i = 0; i < gray.length; i++) gray[i] = count[i] ? gray[i] / count[i] : 0;
  const hash = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash[y * 8 + x] = gray[y * 9 + x] < gray[y * 9 + x + 1] ? 1 : 0;

  return { color, hash };
}

// 0..1, higher is more alike. Color carries most of the weight: turning the product changes
// its shape hash far more than its colors.
export function similarity(a: Signature, b: Signature) {
  let inter = 0;
  for (let i = 0; i < a.color.length; i++) inter += Math.min(a.color[i], b.color[i]);
  let same = 0;
  for (let i = 0; i < 64; i++) if (a.hash[i] === b.hash[i]) same++;
  return 0.7 * inter + 0.3 * (same / 64);
}

// The central 70% of a box: mostly product, little background.
export function innerRegion(box: { x: number; y: number; w: number; h: number }) {
  return { x: box.x + box.w * 0.15, y: box.y + box.h * 0.15, w: box.w * 0.7, h: box.h * 0.7 };
}
