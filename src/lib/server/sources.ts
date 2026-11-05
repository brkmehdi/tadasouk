// The model writes shop links from memory: measured on 2026-11-01, none of the 6 links it gave were
// among the results its own search returned, though the shops and prices were right. So the links
// shown to the merchant and the pages read for photos only ever come from the search results.

// Words of a name or a link, without accents, the way the search index stores them.
export function nameWords(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
}

// The shared key of a barcode: 13 digits. Null for codes that mean nothing outside one shop: prefixes
// 02 and 20 to 29 are for in-store labels and weighed goods, so they may name anything elsewhere.
export function catalogKey(barcode: string | null | undefined) {
  if (!barcode || !/^\d{8,14}$/.test(barcode)) return null;
  const code = barcode.length === 14 && barcode.startsWith("0") ? barcode.slice(1) : barcode;
  if (code.length > 13) return null;
  const key = code.padStart(13, "0");
  return /^(2|02)/.test(key) ? null : key;
}

// A barcode read near a product may be its neighbour's, and neighbours often share a brand: the
// brand alone proves nothing while the entry has a name of its own to compare.
export function sameItem(entry: { name: string; brand: string | null }, name: string | null | undefined) {
  if (!name) return false;
  const wanted = new Set(nameWords(name));
  const brand = new Set(nameWords(entry.brand ?? ""));
  const own = nameWords(entry.name).filter((w) => w.length >= 3 && !brand.has(w) && /[a-z]/.test(w));
  if (own.length) return own.some((w) => wanted.has(w));
  return [...brand].some((w) => wanted.has(w)); // the entry says nothing more, as with a name in Arabic only
}

function parts(url: string) {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\./, ""), words: new Set(nameWords(decodeURIComponent(u.pathname))) };
  } catch {
    return null;
  }
}

const shared = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;

// Each source keeps the real page of the same shop closest to the one claimed; a shop the search
// did not return is dropped.
export function realSources<S extends { url: string }>(sources: S[], found: string[]) {
  const pages = found.flatMap((url) => {
    const p = parts(url);
    return p ? [{ url, ...p }] : [];
  });
  const used = new Set<string>();
  return sources.flatMap((source) => {
    const claimed = parts(source.url);
    if (!claimed) return [];
    const best = pages
      .filter((p) => p.host === claimed.host && !used.has(p.url))
      .sort((a, b) => shared(b.words, claimed.words) - shared(a.words, claimed.words))[0];
    if (!best) return [];
    used.add(best.url);
    return [{ ...source, url: best.url }];
  });
}

// Lists of products, not a product: paths, and the query of shop apps like Glovo (?content=...).
export const NOT_A_PRODUCT = /\/(collections?|categor(y|ie|ies)|product-category|tag|search|recherche|blog|page)\b|[?&](content|category|cat|q|s|search)=/i;

// The search results most likely to be this product's own page, to read a photo from.
export function productPages(found: string[], name: string | null | undefined, limit: number) {
  const wanted = new Set(nameWords(name ?? ""));
  return [...new Set(found)]
    .filter((url) => !NOT_A_PRODUCT.test(url))
    .map((url) => ({ url, hits: shared(parts(url)?.words ?? new Set(), wanted) }))
    .filter((p) => p.hits >= 2)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((p) => p.url);
}
