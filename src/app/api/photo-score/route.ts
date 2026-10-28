// Quality score of one product photo, for the photo preview: muse-spark-1.3 looks at the
// image like a shop photo editor and rates sharpness, light, framing and background.
// Takes the photo itself (data URL) or, for a photo from another site, its public URL.

import { NextResponse } from "next/server";
import { aiContext, errorResponse, responsesJson } from "@/lib/server/meta";
import { chatCost, PRICES, reserve, settle } from "@/lib/server/usage";

type Body = { sessionId: string; image?: string; imageUrl?: string; name?: string | null };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "sharpness", "lighting", "framing", "background", "note"],
  properties: {
    score: { type: "integer", description: "Overall 0-100 as a product photo for an online shop" },
    sharpness: { type: "integer", description: "0-10" },
    lighting: { type: "integer", description: "0-10" },
    framing: { type: "integer", description: "0-10: product whole, centered, filling the frame" },
    background: { type: "integer", description: "0-10: clean and not distracting" },
    note: { type: "string", description: "One short sentence in French: the main thing to improve, or why it is good" },
  },
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, image, imageUrl, name } = body;
  const okImage = typeof image === "string" && image.startsWith("data:image/jpeg;base64,") && image.length < 600_000;
  const okUrl = typeof imageUrl === "string" && /^https:\/\//.test(imageUrl) && imageUrl.length < 2000;
  if (!sessionId || (!okImage && !okUrl)) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    const ctx = await aiContext();
    const p = PRICES["muse-spark-1.3"];
    const r = await reserve(ctx, sessionId, "muse-spark-1.3", "/responses photo-score", 2500 * p.input + 1500 * p.output);
    try {
      const { parsed, usage } = await responsesJson(
        {
          model: "muse-spark-1.3",
          reasoning: { effort: "minimal" },
          max_output_tokens: 1500,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `Rate this photo as a product photo for an online shop${name ? ` (product: ${name})` : ""}. Be strict and concrete.`,
                },
                { type: "input_image", image_url: okImage ? image : imageUrl },
              ],
            },
          ],
        },
        "photo_score",
        SCHEMA,
      );
      const entry = await settle(r, chatCost(usage), true, { inputTokens: usage.prompt_tokens ?? 0 });
      if (!parsed) return NextResponse.json({ error: "no_result" }, { status: 502 });
      return NextResponse.json({ result: parsed, latencyMs: entry.latencyMs });
    } catch (err) {
      await settle(r, 0, false);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
