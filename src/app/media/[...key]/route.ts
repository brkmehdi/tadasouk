// Product photos from R2 (written by /api/media). Each name is unique and never rewritten, so
// browsers and the service worker may keep a photo for a year. Filming videos (/media/captures/,
// signed links) are answered by worker.ts in production and here in `npm run dev`.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { serveVideo } from "@/lib/server/video";

const KEY = /^stores\/[0-9a-f-]{36}\/([0-9a-f-]{36}|hero)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  if (key.startsWith("captures/")) {
    const env = getCloudflareContext().env;
    return serveVideo(req, env.MEDIA, env.MEDIA_LINK_SECRET);
  }
  if (!KEY.test(key)) return new Response("Not found", { status: 404 });
  const object = await getCloudflareContext().env.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: object.httpEtag,
    },
  });
}
