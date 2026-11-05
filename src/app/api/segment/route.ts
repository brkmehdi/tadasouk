// Keyframe -> sam-3.1 mask. The browser sends one downscaled JPEG and the box the on-device
// detector drew; the Worker adds the key and streams the SAM response straight back
// (no parsing here, so it costs almost no CPU). The browser decodes the mask and cuts out
// the product itself.

import { buildObjectPrompt } from "@meta-sam/parser";
import { NextResponse } from "next/server";
import { aiContext, errorResponse, isJpegPhoto, metaFetch } from "@/lib/server/meta";
import { PRICES, spend } from "@/lib/server/usage";

type Body = {
  sessionId: string;
  image: string;
  width: number;
  height: number;
  box: { left: number; top: number; right: number; bottom: number };
  // A tap: the product under this pixel. Sent with candidate boxes of several sizes, one SAM
  // object each (null = the point alone); the browser keeps the best mask.
  point?: { x: number; y: number };
  candidates?: ({ left: number; top: number; right: number; bottom: number } | null)[];
};

const MAX_IMAGE_CHARS = 1_500_000;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, image, width, height, box, point, candidates } = body;
  if (!sessionId || !isJpegPhoto(image, MAX_IMAGE_CHARS) || !(width > 0 && height > 0) || !box || (candidates && (!point || candidates.length > 8))) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const clamp = (v: number, max: number) => Math.min(Math.max(Math.round(v), 0), max);
  const asBox = (b: { left: number; top: number; right: number; bottom: number }) => ({
    left: clamp(b.left, width - 1),
    top: clamp(b.top, height - 1),
    right: clamp(b.right, width),
    bottom: clamp(b.bottom, height),
  });
  const points = point ? [{ x: clamp(point.x, width - 1), y: clamp(point.y, height - 1) }] : undefined;
  const text = buildObjectPrompt({
    size: { width, height },
    objects:
      point && candidates
        ? candidates.map((c, i) => ({ id: i + 1, prompts: [{ ...(c ? { box: asBox(c) } : {}), points }] }))
        : [{ id: 1, prompts: [{ box: asBox(box), ...(points ? { points } : {}) }] }],
  });

  try {
    const ctx = await aiContext();
    const { result: upstream } = await spend(
      ctx,
      sessionId,
      "sam-3.1",
      "/responses",
      PRICES["sam-3.1"].image,
      () =>
        metaFetch("/responses", {
          method: "POST",
          accept: "text/event-stream",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "sam-3.1",
            input: [
              {
                type: "message",
                role: "user",
                content: [
                  { type: "input_text", text },
                  { type: "input_image", image_url: image },
                ],
              },
            ],
            stream: true,
            metadata: { include_confidence: "true" },
          }),
        }),
      () => ({ usd: PRICES["sam-3.1"].image, detail: { width, height } }),
    );
    return new Response(upstream.body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
