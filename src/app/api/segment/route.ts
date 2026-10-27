// Keyframe -> sam-3.1 mask. The browser sends one downscaled JPEG and the box the on-device
// detector drew; the Worker adds the key and streams the SAM response straight back
// (no parsing here, so it costs almost no CPU). The browser decodes the mask and cuts out
// the product itself.

import { buildObjectPrompt } from "@meta-sam/parser";
import { NextResponse } from "next/server";
import { errorResponse, metaFetch, serverEnv } from "@/lib/server/meta";
import { PRICES, reserve, settle } from "@/lib/server/usage";

type Body = {
  sessionId: string;
  image: string;
  width: number;
  height: number;
  box: { left: number; top: number; right: number; bottom: number };
};

const MAX_IMAGE_CHARS = 1_500_000;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, image, width, height, box } = body;
  if (
    !sessionId ||
    typeof image !== "string" ||
    !image.startsWith("data:image/jpeg;base64,") ||
    image.length > MAX_IMAGE_CHARS ||
    !(width > 0 && height > 0) ||
    !box
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const clamp = (v: number, max: number) => Math.min(Math.max(Math.round(v), 0), max);
  const text = buildObjectPrompt({
    size: { width, height },
    objects: [
      {
        id: 1,
        prompts: [
          {
            box: {
              left: clamp(box.left, width - 1),
              top: clamp(box.top, height - 1),
              right: clamp(box.right, width),
              bottom: clamp(box.bottom, height),
            },
          },
        ],
      },
    ],
  });

  try {
    const { caps } = serverEnv();
    const r = reserve(caps, sessionId, "sam-3.1", "/responses", PRICES["sam-3.1"].image);
    let upstream: Response;
    try {
      upstream = await metaFetch("/responses", {
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
        }),
      });
    } catch (err) {
      settle(r, 0, false);
      throw err;
    }
    settle(r, PRICES["sam-3.1"].image, true, { width, height });
    return new Response(upstream.body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
