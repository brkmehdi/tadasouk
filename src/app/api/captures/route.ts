// The raw video of a filming session, kept for the platform owner (watched in /admin/videos).
// The phone sends it after the merchant stops filming, in 8 MiB parts of an R2 multipart upload
// through the MEDIA binding: no storage keys in the Worker, and only a signed-in merchant can
// write, under a key that carries their user id. Videos stay until the owner deletes them; the
// bucket aborts unfinished uploads after 7 days.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { NotSignedInError, requireUser } from "@/lib/server/auth";

const TYPES: Record<string, string> = { "video/webm": "webm", "video/mp4": "mp4" };
const PART_BYTES = 8 * 1024 * 1024;
const MAX_PARTS = 50; // 400 MiB, about 20 minutes at 2.5 Mbit/s
const KEY = /^captures\/\d{4}-\d{2}-\d{2}\/([0-9a-f-]{36})\/[a-zA-Z0-9-]{8,64}\.(webm|mp4)$/;

const bad = () => NextResponse.json({ error: "bad_request" }, { status: 400 });

// The key must be one this user started.
async function ownKey(key: string | null) {
  const user = await requireUser();
  const m = key ? KEY.exec(key) : null;
  return m && m[1] === user.id ? key : null;
}

function fail(err: unknown) {
  if (err instanceof NotSignedInError) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  console.error("capture upload:", err);
  return NextResponse.json({ error: "upload_failed" }, { status: 500 });
}

// { action: "start", sessionId, contentType, bytes, seconds } -> { key, uploadId, partBytes }
// { action: "complete", key, uploadId, parts } | { action: "abort", key, uploadId }
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      sessionId?: string;
      contentType?: string;
      bytes?: number;
      seconds?: number;
      key?: string;
      uploadId?: string;
      parts?: { partNumber: number; etag: string }[];
    };
    const media = getCloudflareContext().env.MEDIA;

    if (body.action === "start") {
      const type = body.contentType?.split(";")[0] ?? "";
      const bytes = Number(body.bytes);
      if (!body.sessionId || !/^[a-zA-Z0-9-]{8,64}$/.test(body.sessionId) || !TYPES[type]) return bad();
      if (!(bytes > 0) || bytes > PART_BYTES * MAX_PARTS) return NextResponse.json({ error: "too_big" }, { status: 413 });
      const key = `captures/${new Date().toISOString().slice(0, 10)}/${user.id}/${body.sessionId}.${TYPES[type]}`;
      const upload = await media.createMultipartUpload(key, {
        httpMetadata: { contentType: type },
        customMetadata: { seconds: String(Math.round(Number(body.seconds) || 0)), bytes: String(bytes) },
      });
      return NextResponse.json({ key, uploadId: upload.uploadId, partBytes: PART_BYTES });
    }

    const key = await ownKey(body.key ?? null);
    if (!key || !body.uploadId) return bad();
    const upload = media.resumeMultipartUpload(key, body.uploadId);
    if (body.action === "abort") {
      await upload.abort();
      return NextResponse.json({ ok: true });
    }
    if (body.action === "complete" && Array.isArray(body.parts) && body.parts.length && body.parts.length <= MAX_PARTS) {
      const object = await upload.complete(body.parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
      return NextResponse.json({ key, size: object.size });
    }
    return bad();
  } catch (err) {
    return fail(err);
  }
}

// PUT ?key=&uploadId=&part=n with the part's bytes -> { partNumber, etag }
export async function PUT(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const key = await ownKey(q.get("key"));
    const uploadId = q.get("uploadId");
    const part = Number(q.get("part"));
    if (!key || !uploadId || !Number.isInteger(part) || part < 1 || part > MAX_PARTS) return bad();
    const bytes = await req.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > PART_BYTES) return bad();
    const uploaded = await getCloudflareContext().env.MEDIA.resumeMultipartUpload(key, uploadId).uploadPart(part, bytes);
    return NextResponse.json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
  } catch (err) {
    return fail(err);
  }
}
