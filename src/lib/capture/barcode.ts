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

function pixels(src: HTMLVideoElement | HTMLCanvasElement) {
  const w = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const h = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
  if (!w || !h) return null;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  scratch ??= document.createElement("canvas");
  scratch.width = Math.round(w * scale);
  scratch.height = Math.round(h * scale);
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, scratch.width, scratch.height);
  return ctx.getImageData(0, 0, scratch.width, scratch.height);
}

// The barcode visible in a video frame or photo, or null.
export async function readBarcode(src: HTMLVideoElement | HTMLCanvasElement): Promise<string | null> {
  const det = await nativeDetector();
  if (det) {
    const found = await det.detect(src).catch(() => []);
    return clean(found[0]?.rawValue);
  }
  const data = pixels(src);
  if (!data) return null;
  const { readBarcodes } = await zxingReader();
  const results = await readBarcodes(data, {
    formats: [...ZXING_FORMATS],
    tryHarder: true,
    tryRotate: true,
    maxNumberOfSymbols: 1,
  }).catch(() => []);
  const ok = results.find((r) => r.isValid);
  return clean(ok?.text);
}

function clean(code: string | undefined | null) {
  const c = code?.trim();
  return c && c.length >= 6 ? c : null;
}
