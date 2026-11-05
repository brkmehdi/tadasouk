// Quality and fidelity of all the photos of one product, used to rank them: see
// src/lib/server/score.ts. Each photo is a JPEG data URL, or the https address of a shop's photo.

import { NextResponse } from "next/server";
import { aiContext, errorResponse, isJpegPhoto } from "@/lib/server/meta";
import { scorePhotos } from "@/lib/server/score";
import { chatCost, PRICES, spend } from "@/lib/server/usage";

type Body = { sessionId: string; photos: string[]; name?: string | null };

const MAX_PHOTOS = 8;

const usable = (s: unknown) => isJpegPhoto(s) || (typeof s === "string" && s.startsWith("https://") && s.length < 2000);

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, photos, name } = body;
  if (!sessionId || !Array.isArray(photos) || !photos.length || photos.length > MAX_PHOTOS || !photos.every(usable)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const ctx = await aiContext();
    const p = PRICES["muse-spark-1.3"];
    const { result, entry } = await spend(
      ctx,
      sessionId,
      "muse-spark-1.3",
      "/responses photo-score",
      photos.length * 2500 * p.input + 2500 * p.output,
      () => scorePhotos(photos, name),
      ({ usage }) => ({
        usd: chatCost(usage),
        detail: { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0, photos: photos.length },
      }),
    );
    if (!result.read) return NextResponse.json({ error: "no_result" }, { status: 502 });
    return NextResponse.json({ results: result.results, latencyMs: entry.latencyMs });
  } catch (err) {
    return errorResponse(err);
  }
}
