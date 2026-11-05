// Barcode reading on the phone: the browser's own BarcodeDetector when it has one (Chrome on
// Android), else ZXing compiled to WebAssembly (iPhone, desktop). Retail formats only.
// The .wasm file is served from /zxing_reader.wasm (copied from zxing-wasm 3.1.4).

type NativeDetector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type NativeDetectorCtor = {
  new (opts: { formats: string[] }): NativeDetector;
  getSupportedFormats: () => Promise<string[]>;
};

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
const ZXING_FORMATS = ["EAN13", "EAN8", "UPCA", "UPCE", "Code128"] as const;
const MAX_SIDE = 1280;
const LIGHT_MAX_SIDE = 960;

let native: Promise<NativeDetector | null> | null = null;
let zxing: Promise<typeof import("zxing-wasm/reader")> | null = null;
let scratch: HTMLCanvasElement | null = null;

function nativeDetector() {
  native ??= (async () => {
    const Ctor = (globalThis as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
    if (!Ctor) return null;
    const supported = await Ctor.getSupportedFormats().catch(() => [] as string[]);
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new Ctor({ formats }) : null;
  })();
  return native;
}

function zxingReader() {
  zxing ??= import("zxing-wasm/reader").then((m) => {
    m.prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path) },
    });
    return m;
  });
  return zxing;
}

// Starts loading the reader early so the first scan does not wait for it.
export function warmUpBarcodes() {
  void nativeDetector().then((n) => (n ? null : zxingReader()));
}

function pixels(src: HTMLVideoElement | HTMLCanvasElement, maxSide: number) {
  const w = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const h = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
  if (!w || !h) return null;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  scratch ??= document.createElement("canvas");
  scratch.width = Math.round(w * scale);
  scratch.height = Math.round(h * scale);
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, scratch.width, scratch.height);
  return ctx.getImageData(0, 0, scratch.width, scratch.height);
}

// The barcode visible in a video frame or photo, or null. `thorough` is for a screen made for
// scanning; while filming the search runs in the background, so it stays light.
export async function readBarcode(src: HTMLVideoElement | HTMLCanvasElement, thorough = false): Promise<string | null> {
  const det = await nativeDetector();
  if (det) {
    const found = await det.detect(src).catch(() => []);
    return clean(found[0]?.rawValue);
  }
  const data = pixels(src, thorough ? MAX_SIDE : LIGHT_MAX_SIDE);
  if (!data) return null;
  const { readBarcodes } = await zxingReader();
  const results = await readBarcodes(data, {
    formats: [...ZXING_FORMATS],
    tryHarder: thorough,
    tryRotate: true,
    maxNumberOfSymbols: 1,
  }).catch(() => []);
  const ok = results.find((r) => r.isValid);
  return clean(ok?.text);
}

type Shot = { canvas: HTMLCanvasElement; box: { x: number; y: number; w: number; h: number }; still?: Promise<HTMLCanvasElement | null> | null };

// The product's area alone, enlarged: on a whole frame the bars of a barcode are often too thin to read.
function zoomed(src: HTMLCanvasElement, shot: Shot) {
  const r = src.width / shot.canvas.width;
  const x = Math.max(0, shot.box.x - shot.box.w * 0.15) * r;
  const y = Math.max(0, shot.box.y - shot.box.h * 0.15) * r;
  const w = Math.min(src.width - x, shot.box.w * 1.3 * r);
  const h = Math.min(src.height - y, shot.box.h * 1.3 * r);
  const c = document.createElement("canvas");
  const s = MAX_SIDE / Math.max(w, h);
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

// The barcode of a captured shot: the real photo first, then the video frame, each whole and then
// zoomed on the product. The live scan looks at a small frame once a second and misses codes this finds.
export async function readShot(shot: Shot) {
  const still = await shot.still?.catch(() => null);
  for (const src of still ? [still, shot.canvas] : [shot.canvas]) {
    const code = (await readBarcode(src, true)) ?? (await readBarcode(zoomed(src, shot), true));
    if (code) return code;
  }
  return null;
}

function clean(code: string | undefined | null) {
  const c = code?.trim();
  return c && c.length >= 6 ? c : null;
}
