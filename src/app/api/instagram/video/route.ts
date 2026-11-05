// One of the merchant's Instagram videos, passed through to the phone, which reads it like a video
// of its own (see VideoImport). Nothing is stored.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/meta";
import { NotLinkedError, openVideo, TOKEN_COOKIE, unseal } from "@/lib/server/instagram";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const user = await requireUser();
    const link = await unseal((await cookies()).get(TOKEN_COOKIE)?.value, user.id);
    const video = await openVideo(link, id);
    if (!video) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const headers = new Headers({ "Content-Type": video.headers.get("content-type") ?? "video/mp4", "Cache-Control": "private, no-store" });
    const size = video.headers.get("content-length");
    if (size) headers.set("Content-Length", size);
    return new Response(video.body, { headers });
  } catch (err) {
    if (err instanceof NotLinkedError) return NextResponse.json({ error: "not_linked" }, { status: 409 });
    return errorResponse(err);
  }
}
