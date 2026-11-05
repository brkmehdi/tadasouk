// One image from a shop's site, read on the server because the browser may not read it (another
// origin). The request says who it is; a site that refuses it simply gives no image. The Worker
// runs with global_fetch_strictly_public, so private addresses are unreachable.

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 5000;

export async function fetchWebImage(url: string) {
  if (!/^https:\/\//.test(url) || url.length > 2000) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TadasoukBot/0.1; +https://tadasouk.com)", Accept: "image/*" },
    });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!res.ok || !TYPES.includes(type)) return null;
    const bytes = await res.arrayBuffer();
    return bytes.byteLength && bytes.byteLength <= MAX_BYTES ? { type, bytes } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
