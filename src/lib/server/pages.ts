// Reading shop pages, and proving a link is worth showing. A link from the search can be real and
// still useless: a shop's category page answers 200 and does not mention the product, and a blog or
// another brand can mention it. So each page is opened and judged. Only its start is read.

import { nameWords, NOT_A_PRODUCT } from "./sources";

const MAX_BYTES = 200_000;
const TIMEOUT_MS = 4000;
const MAX_CHECKED = 6; // pages opened for one product: also what a Worker may open at once
const MAX_SHOWN = 3;

export async function readPage(url: string) {
  return (await openPage(url)).page;
}

// `refused`: the site turned the request away, which says nothing about the page.
async function openPage(url: string): Promise<{ page: { html: string; finalUrl: string } | null; refused: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TadasoukBot/0.1; +https://tadasouk.com)", Accept: "text/html" },
    });
    if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("html")) {
      res.body?.cancel().catch(() => {});
      return { page: null, refused: res.status === 403 || res.status === 429 };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    while (html.length < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    return { page: { html, finalUrl: res.url || url }, refused: false };
  } catch {
    return { page: null, refused: ctrl.signal.aborted }; // no answer in time: the same as a refusal; a dead site is not
  } finally {
    clearTimeout(timer);
  }
}

// The words that identify a product: its name without sizes. The first one is usually the brand.
function identity(name: string) {
  return [...new Set(nameWords(name).filter((w) => !/^\d+([.,]\d+)?(ml|cl|l|g|gr|kg|cc|x)?$/.test(w)))];
}

// True when these words are the product: its first two words, usually the brand and the model. Any
// later word would do for a neighbour: "Lattafa Ameer eau de parfum" is not "Lattafa Emeer".
const namesProduct = (words: Set<string>, wanted: string[]) => wanted.length > 0 && wanted.slice(0, 2).every((w) => words.has(w));

const PRODUCT_PAGE = /"@type"\s*:\s*"Product"|property=["']og:type["'][^>]+content=["'](og:)?product|add[ -]to[ -]cart|ajouter au panier/i;

// The page's own title says what it is about; a word lost in its menus proves nothing.
function pageTitle(html: string) {
  const parts = [/<title[^>]*>([^<]+)/i, /<h1[^>]*>([^<]+)/i, /property=["']og:title["'][^>]+content=["']([^"']+)/i];
  return parts.map((re) => html.match(re)?.[1] ?? "").join(" ");
}

type Source = { title: string; url: string; price: number | null };

// The links worth showing, each one opened: first those the research cited, then other product
// pages from its search, the shops of Morocco first. A page counts if it is a shop's page and its
// title names the product. A site that turns us away counts only if its address names the product.
// A cited price with no page behind it stays in the price range; only its link goes.
export async function checkedSources(cited: Source[], pages: string[], name: string) {
  const wanted = identity(name);
  const seen = new Set<string>();
  const list = [...cited, ...pages.map((url) => ({ title: "", url, price: null }))]
    .filter((s) => !NOT_A_PRODUCT.test(s.url) && !seen.has(s.url) && !!seen.add(s.url))
    .slice(0, MAX_CHECKED);
  const opened = await Promise.all(
    list.map(async (s) => {
      const { page, refused } = await openPage(s.url);
      if (page) {
        const title = pageTitle(page.html);
        if (!PRODUCT_PAGE.test(page.html) || !namesProduct(new Set(nameWords(title)), wanted)) return null;
        return { ...s, title: s.title || title.trim().slice(0, 100) };
      }
      const address = new Set(nameWords(decodeURIComponent(new URL(s.url).pathname)));
      return refused && namesProduct(address, wanted) ? { ...s, title: s.title || new URL(s.url).hostname } : null;
    }),
  );
  const moroccan = (s: Source) => (new URL(s.url).hostname.endsWith(".ma") ? 0 : 1);
  return opened
    .flatMap((s) => (s ? [s] : []))
    .sort((x, y) => moroccan(x) - moroccan(y))
    .slice(0, MAX_SHOWN);
}
