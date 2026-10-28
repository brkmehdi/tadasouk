// Filming videos for the platform owner, served from R2 at /media/captures/...?exp=&sig=.
//
// In production the Worker entry (worker.ts) answers these URLs before Next.js runs: the R2 body
// streams straight to the browser. Through Next.js (OpenNext) the Worker read the whole file
// ahead of a slow video player and ran out of memory (Cloudflare error 1102). Without a session
// lookup at that point, access is a link signed for the admin page: HMAC-SHA256 of the key and an
// expiry, with MEDIA_LINK_SECRET. `npm run dev` serves the same URLs through /media/[...key].
//
// No "@/" imports: worker.ts is bundled by wrangler, outside Next.js.

const KEY = /^captures\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/[a-zA-Z0-9-]{8,64}\.(webm|mp4)$/;
const LINK_HOURS = 12;

async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signedVideoUrl(key: string, secret: string) {
  const exp = Math.floor(Date.now() / 1000) + LINK_HOURS * 3600;
  return `/media/${key}?exp=${exp}&sig=${await hmac(secret, `${key}\n${exp}`)}`;
}

async function linkIsValid(key: string, exp: string | null, sig: string | null, secret: string) {
  if (!secret || !exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  const expected = await hmac(secret, `${key}\n${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// GET /media/captures/... : plays (with byte ranges, so the player can seek) or downloads.
export async function serveVideo(req: Request, media: R2Bucket, secret: string | undefined) {
  const url = new URL(req.url);
  const key = decodeURIComponent(url.pathname.slice("/media/".length));
  if (!KEY.test(key) || !(await linkIsValid(key, url.searchParams.get("exp"), url.searchParams.get("sig"), secret ?? ""))) {
    return new Response("Not found", { status: 404 });
  }
  const meta = await media.head(key);
  if (!meta) return new Response("Not found", { status: 404 });
  const size = meta.size;

  const headers = new Headers({
    "Content-Type": meta.httpMetadata?.contentType ?? "video/webm",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    ETag: meta.httpEtag,
  });
  if (url.searchParams.get("download")) headers.set("Content-Disposition", `attachment; filename="${key.split("/").slice(1).join("-")}"`);

  // Worked out here from the request and the size: for "bytes=N-", R2's answer does not say
  // where the range starts.
  const range = byteRange(req.headers.get("range"), size);
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const object = await media.get(key, range ? { range } : undefined);
  if (!object) return new Response("Not found", { status: 404 });
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
    headers.set("Content-Length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(object.body, { headers });
}

// "bytes=a-b", "bytes=a-" or "bytes=-n" (one range only), clamped to the file.
function byteRange(header: string | null, size: number) {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (!m[1] && !m[2])) return null;
  let offset: number, end: number;
  if (!m[1]) {
    const n = Math.min(Number(m[2]), size);
    if (!n) return "unsatisfiable" as const;
    offset = size - n;
    end = size - 1;
  } else {
    offset = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (offset >= size || end < offset) return "unsatisfiable" as const;
  return { offset, length: end - offset + 1 };
}
