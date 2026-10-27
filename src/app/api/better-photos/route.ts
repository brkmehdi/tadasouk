// "Find better photos for this product": muse-image-1.0 takes the merchant's own photo,
// looks the product up on the web by itself (built-in image and web search), and returns
// clean studio shots of the same product. The Worker streams the result straight through.

import { NextResponse } from "next/server";
import { errorResponse, metaFetch, serverEnv } from "@/lib/server/meta";
import { PRICES, reserve, settle } from "@/lib/server/usage";

type Body = {
  sessionId: string;
  image: string;
  name?: string | null;
  label?: string | null;
  color?: string | null;
};

const COUNT = 1; // one AI photo; real web photos come from /api/web-photos

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, image, name, label, color } = body;
  if (!sessionId || typeof image !== "string" || !image.startsWith("data:image/jpeg;base64,") || image.length > 1_500_000) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const what = name || [color, label].filter(Boolean).join(" ") || "product";
  const prompt = [
    `Professional e-commerce photo of the exact product shown in the reference photo (${what}).`,
    `Look up this product online if it is a known brand, so labels and packaging are accurate.`,
    `Keep the product identical: same shape, colors, label and text. Do not add or remove parts.`,
    `Plain light studio background, soft natural shadow, product centered, square framing.`,
  ].join(" ");

  try {
    const { caps } = serverEnv();
    const cost = COUNT * PRICES["muse-image-1.0"].image;
    const r = reserve(caps, sessionId, "muse-image-1.0", "/images/edits", cost);
    let upstream: Response;
    try {
      upstream = await metaFetch("/images/edits", {
        method: "POST",
        accept: "text/event-stream",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "muse-image-1.0",
          prompt,
          images: [{ image_url: image }],
          n: COUNT,
          size: "1024x1024",
          reasoning_strength: "low",
          stream: true,
        }),
      });
    } catch (err) {
      settle(r, 0, false);
      throw err;
    }
    // Billed per image actually returned; settled at the requested count (upper bound).
    settle(r, cost, true, { images: COUNT });
    return new Response(upstream.body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
