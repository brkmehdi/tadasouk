// Real photos of a product from the web: for each shop page the price research found, read
// the start of the page and take its main product image (Open Graph image or the image of the
// schema.org Product). Only the first 200 KB of each page is read and nothing is parsed beyond
// a few regular expressions, so the Worker stays light. Pages are fetched with the
// global_fetch_strictly_public flag, so private addresses are unreachable.

import { NextResponse } from "next/server";

type Body = { sessionId: string; urls: string[] };
type Photo = { image: string; page: string; site: string };

const MAX_PAGES = 5;
const MAX_BYTES = 200_000;
const TIMEOUT_MS = 5000;

// Images that are never the product itself.
const NOT_PRODUCT = /logo|favicon|sprite|placeholder|banner|default|og-?image|opengraph|share|icon/i;

async function readHead(url: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SmallStoreBot/0.1)", Accept: "text/html" },
    });
    if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    while (html.length < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    return { html, finalUrl: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
      const got = await readHead(page);
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
