// Studio version of the merchant's own photo. The browser sends the SAM cutout centered on
// white; muse-image-1.0 paints only a backdrop and a shadow around it. The browser then puts
// the real cutout pixels back on top and checks the product was not moved or altered, so the
// product in the final image is exactly what the camera saw.

import { NextResponse } from "next/server";
import { aiContext, errorResponse, metaFetch } from "@/lib/server/meta";
import { PRICES, reserve, settle } from "@/lib/server/usage";

type Body = { sessionId: string; image: string; name?: string | null };

const PROMPT = [
  "Product photography edit. Replace only the plain white background with a clean, light photo-studio backdrop",
  "(soft neutral gradient, subtle surface) and add a soft natural contact shadow under the product.",
  "Do not change the product in any way: same position, size, angle, shape, colors, label and text.",
  "Keep the exact framing of the input image.",
].join(" ");

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, image } = body;
  if (!sessionId || typeof image !== "string" || !image.startsWith("data:image/jpeg;base64,") || image.length > 1_500_000) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const ctx = await aiContext();
    const cost = PRICES["muse-image-1.0"].image;
    const r = await reserve(ctx, sessionId, "muse-image-1.0", "/images/edits studio", cost);
    let upstream: Response;
    try {
      upstream = await metaFetch("/images/edits", {
        method: "POST",
        accept: "text/event-stream",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "muse-image-1.0",
          prompt: PROMPT,
          images: [{ image_url: image }],
          n: 1,
          size: "1024x1024",
          reasoning_strength: "low",
          // Nothing to look up for a backdrop; search off keeps it fast.
          tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
          stream: true,
        }),
      });
    } catch (err) {
      await settle(r, 0, false);
      throw err;
    }
    await settle(r, cost, true, { images: 1 });
    return new Response(upstream.body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
