// A photographed product -> its entry in the shared catalog: see src/lib/server/catalog-match.ts.

import { NextResponse } from "next/server";
import { matchProduct } from "@/lib/server/catalog-match";
import { aiContext, errorResponse, isJpegPhoto } from "@/lib/server/meta";
import { chatCost, PRICES, spend } from "@/lib/server/usage";

type Body = { sessionId: string; image: string; name: string };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, image, name } = body;
  if (!sessionId || typeof name !== "string" || !name.trim() || !isJpegPhoto(image)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const ctx = await aiContext();
    const p = PRICES["muse-spark-1.3"];
    const { result: found } = await spend(
      ctx,
      sessionId,
      "muse-spark-1.3",
      "/responses catalog-match",
      9000 * p.input + 1500 * p.output,
      () => matchProduct(image, name),
      (found) => ({
        usd: found ? chatCost(found.usage) : 0,
        detail: { inputTokens: found?.usage.prompt_tokens ?? 0, outputTokens: found?.usage.completion_tokens ?? 0 },
      }),
    );
    return NextResponse.json({ product: found?.product ?? null, confidence: found?.confidence ?? 0 });
  } catch (err) {
    return errorResponse(err);
  }
}
