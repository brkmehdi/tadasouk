// Short-lived signed PUT URL so the browser uploads the raw capture video straight to R2.
// The video body never passes through the Worker. Raw captures live under `captures/`,
// which an R2 lifecycle rule deletes after 7 days.

import { AwsClient } from "aws4fetch";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

const TYPES: Record<string, string> = { "video/webm": "webm", "video/mp4": "mp4" };

export async function POST(req: Request) {
  const env = getCloudflareContext().env;
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return NextResponse.json({ error: "r2_not_configured" }, { status: 503 });
  }
  const { sessionId, contentType } = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    contentType?: string;
  };
  const baseType = contentType?.split(";")[0] ?? "";
  if (!sessionId || !/^[a-zA-Z0-9-]{8,64}$/.test(sessionId) || !TYPES[baseType]) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const key = `captures/${new Date().toISOString().slice(0, 10)}/${sessionId}.${TYPES[baseType]}`;
  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`,
  );
  url.searchParams.set("X-Amz-Expires", "600");
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const signed = await client.sign(new Request(url, { method: "PUT", headers: { "Content-Type": baseType } }), {
    aws: { signQuery: true },
  });
  return NextResponse.json({ url: signed.url, key, contentType: baseType });
}
