// Stock count from a shelf photo (/api/count): what the browser prepares before asking the AI.
// The catalog goes as ONE numbered grid image (one cell per colour photo, or the cover), which
// costs far less than one image per product; the answer comes back as cell numbers.

import { colorsOf, mediaUrl, photosOf, type CatalogProduct } from "./types";

export const MAX_CELLS = 24;
export const MAX_IMAGE = 1_200_000; // data URL length the route accepts

// Lower the JPEG quality until the image fits what the route accepts.
function fitJpeg(canvas: HTMLCanvasElement) {
  let url = "";
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= MAX_IMAGE) break;
  }
  return url;
}

export type CountCell = { productId: string; colorId: string | null; colorName: string | null; url: string };
export type CountItem = { productId: string; colorId: string | null; x: number; y: number; w: number; h: number }; // 0-1

// One cell per colour that has a photo; a product without colours uses its main photo.
export function countCells(products: CatalogProduct[]): CountCell[] {
  const cells: CountCell[] = [];
  for (const p of products) {
    if (p.status === "archived") continue;
    const photos = photosOf(p);
    const byColor = colorsOf(p)
      .map((c) => ({ c, photo: photos.find((i) => i.color_id === c.id) }))
      .filter((x) => x.photo);
    if (byColor.length) {
      for (const { c, photo } of byColor) cells.push({ productId: p.id, colorId: c.id, colorName: c.name, url: mediaUrl(photo!.r2_key) });
    } else if (photos[0]) {
      cells.push({ productId: p.id, colorId: null, colorName: null, url: mediaUrl(photos[0].r2_key) });
    }
  }
  return cells;
}

async function loadImage(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

// 6 columns of 200 x 260 cells, the number in a black box in the corner.
export async function catalogGrid(cells: CountCell[]) {
  const CW = 200, CH = 260, COLS = 6;
  const canvas = document.createElement("canvas");
  canvas.width = COLS * CW;
  canvas.height = Math.ceil(cells.length / COLS) * CH;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  const images = await Promise.all(cells.map((c) => loadImage(c.url).catch(() => null)));
  images.forEach((img, i) => {
    const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
    if (img) {
      const s = Math.min((CW - 16) / img.naturalWidth, (CH - 16) / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      g.drawImage(img, x + (CW - w) / 2, y + (CH - h) / 2, w, h);
    }
    g.strokeStyle = "#999";
    g.strokeRect(x + 0.5, y + 0.5, CW - 1, CH - 1);
    g.fillStyle = "#000";
    g.fillRect(x, y, 52, 44);
    g.fillStyle = "#fff";
    g.font = "bold 32px Arial, sans-serif";
    g.fillText(String(i + 1), x + 6, y + 34);
  });
  return fitJpeg(canvas);
}

// The shelf photo, upright (phone photos carry their rotation) and at most 1280 px on its long side.
export async function shelfJpeg(file: Blob) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * s);
  canvas.height = Math.round(bmp.height * s);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return { url: fitJpeg(canvas), width: canvas.width, height: canvas.height };
}
