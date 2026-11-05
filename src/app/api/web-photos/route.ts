// Real photos of a product from the web: for each shop page the price research found, read
// the start of the page and take its main product image (Open Graph image or the image of the
// schema.org Product). Only the first 200 KB of each page is read and nothing is parsed beyond
// a few regular expressions, so the Worker stays light. Pages are fetched with the
// global_fetch_strictly_public flag, so private addresses are unreachable.

import { NextResponse } from "next/server";
import { readPage } from "@/lib/server/pages";

type Body = { sessionId: string; urls: string[] };
type Photo = { image: string; page: string; site: string };

const MAX_PAGES = 6; // pages the price research found, so no AI cost; the merchant sees 3 photos at most

// Images that are never the product itself.
const NOT_PRODUCT = /logo|favicon|sprite|placeholder|banner|default|og-?image|opengraph|share|icon/i;

function productImage(html: string, base: string) {
  const candidates: string[] = [];
  // schema.org Product "image" (string or first array item)
  const ld = html.match(/"@type"\s*:\s*"Product"[\s\S]{0,4000}?"image"\s*:\s*(?:\[\s*)?"([^"]+)"/);
  if (ld) candidates.push(ld[1]);
  for (const re of [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ]) {
    const m = html.match(re);
    if (m) candidates.push(m[1]);
  }
  for (const c of candidates) {
    try {
      const u = new URL(c.replace(/&amp;/g, "&").replace(/\\\//g, "/"), base);
      // An image at the root of the site (/share.png) is the site's card, not the product.
      const rootLevel = u.pathname.split("/").filter(Boolean).length <= 1;
      if ((u.protocol === "https:" || u.protocol === "http:") && !rootLevel && !NOT_PRODUCT.test(u.pathname)) {
        u.protocol = "https:"; // the store is served over https; avoid mixed content
        return u.toString();
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  if (!body.sessionId || !Array.isArray(body.urls)) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const urls = [
    ...new Set(
      body.urls.filter((u) => {
        try {
          const p = new URL(u).protocol;
          return p === "https:" || p === "http:";
        } catch {
          return false;
        }
      }),
    ),
  ].slice(0, MAX_PAGES);

  const results = await Promise.all(
    urls.map(async (page): Promise<Photo | null> => {
      const got = await readPage(page);
      if (!got) return null;
      const image = productImage(got.html, got.finalUrl);
      return image ? { image, page, site: new URL(got.finalUrl).hostname.replace(/^www\./, "") } : null;
    }),
  );
  const seen = new Set<string>();
  const photos = results.filter((p): p is Photo => !!p && !seen.has(p.image) && !!seen.add(p.image));
  console.log(JSON.stringify({ webPhotos: { sessionId: body.sessionId, pages: urls.length, photos: photos.length } }));
  return NextResponse.json({ photos });
}
