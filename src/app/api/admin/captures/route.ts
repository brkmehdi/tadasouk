// A filming video for the platform owner only: plays in /admin/videos (with byte ranges, so the
// player can seek) or downloads with ?download=1.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { adminUser } from "@/lib/server/admin";

const KEY = /^captures\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/[a-zA-Z0-9-]{8,64}\.(webm|mp4)$/;

export async function GET(req: Request) {
  if (!(await adminUser())) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const key = q.get("key") ?? "";
  if (!KEY.test(key)) return new Response("Not found", { status: 404 });

  const media = getCloudflareContext().env.MEDIA;
  const ranged = req.headers.has("range");
  const object = await media.get(key, ranged ? { range: req.headers } : undefined);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType ?? "video/webm",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    ETag: object.httpEtag,
  });
  if (q.get("download")) headers.set("Content-Disposition", `attachment; filename="${key.split("/").slice(1).join("-")}"`);

  const r = object.range;
  if (ranged && r) {
    const offset = "suffix" in r ? object.size - r.suffix : (r.offset ?? 0);
    const length = "suffix" in r ? r.suffix : (r.length ?? object.size - offset);
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}
