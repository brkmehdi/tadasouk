// Product photos from other angles: muse-image-1.0 takes the merchant's own photo, looks the
// product up on the web by itself (built-in image and web search) to learn the sides the
// camera did not see, and returns one studio shot from the requested angle. The browser asks
// for several angles in parallel. The Worker streams the result straight through.

import { NextResponse } from "next/server";
import { aiContext, errorResponse, metaFetch, watchRefusal } from "@/lib/server/meta";
import { PRICES, reserve, settle } from "@/lib/server/usage";

type Body = {
  sessionId: string;
  image: string;
  angle?: Angle;
  name?: string | null;
  label?: string | null;
  color?: string | null;
};

export type Angle = "three_quarter" | "side" | "back";

const ANGLES: Record<Angle, string> = {
  three_quarter: "Show it from a three-quarter angle, about 35 degrees to the left, so the front and one side are visible.",
  side: "Show its side profile.",
  back: "Show the back of the product (back label, ingredients or details) as it appears on reference images of this exact product online.",
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, image, name, label, color } = body;
  const angle: Angle = body.angle && body.angle in ANGLES ? body.angle : "three_quarter";
  if (!sessionId || typeof image !== "string" || !image.startsWith("data:image/jpeg;base64,") || image.length > 1_500_000) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const what = name || [color, label].filter(Boolean).join(" ") || "product";
  const prompt = [
    `Professional e-commerce photo of the exact product shown in the reference photo (${what}).`,
    ANGLES[angle],
    `Look up this product online to see its other sides, so labels and packaging are accurate.`,
    `Keep the product identical: same shape, colors, label and text. Do not add or remove parts.`,
    `If this view makes no sense for this kind of product (for example a flat item), show the product held in a hand or in use instead.`,
    `Plain light studio background, soft natural shadow, product centered, square framing.`,
  ].join(" ");

  try {
    const ctx = await aiContext();
    const cost = PRICES["muse-image-1.0"].image;
    const r = await reserve(ctx, sessionId, "muse-image-1.0", "/images/edits", cost);
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
          n: 1,
          size: "1024x1024",
          reasoning_strength: "low",
          stream: true,
        }),
      });
    } catch (err) {
      await settle(r, 0, false);
      throw err;
    }
    // Billed per image actually returned: a refused one costs nothing.
    const { refused, body: stream } = await watchRefusal(upstream).catch(async (err: unknown) => {
      await settle(r, 0, false);
      throw err;
    });
    await settle(r, refused ? 0 : cost, true, { images: refused ? 0 : 1, angle });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
