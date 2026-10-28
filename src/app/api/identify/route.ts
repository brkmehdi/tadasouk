// Names a freshly captured product from its cutout: muse-spark-1.3 image understanding with
// a fixed JSON answer. Cheap (one small image, low reasoning), run once per product.

import { NextResponse } from "next/server";
import { aiContext, errorResponse, responsesJson } from "@/lib/server/meta";
import { chatCost, PRICES, reserve, settle } from "@/lib/server/usage";

type Body = { sessionId: string; image: string; label?: string | null; hint?: string | null };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name_fr", "name_ar", "category", "description_fr", "confident"],
  properties: {
    name_fr: { type: "string", description: "Short shop title in French, with brand and size when visible" },
    name_ar: { type: "string", description: "Same title in Arabic" },
    category: { type: "string", description: "One shop category in French, e.g. Épicerie, Beauté, Maison" },
    description_fr: { type: "string", description: "One or two plain sentences in French, only facts visible on the product" },
    confident: { type: "boolean", description: "false when the photo is too unclear to tell what it is" },
  },
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, image, label, hint } = body;
  if (!sessionId || typeof image !== "string" || !image.startsWith("data:image/jpeg;base64,") || image.length > 600_000) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const ask = [
    "This is a product a small shop in Morocco is putting online.",
    label ? `An on-device detector called it "${label}".` : "",
    hint ? `The merchant said: "${hint}".` : "",
    "Name it as a shop would list it. Read any brand, flavor and size printed on it. Do not invent details you cannot see.",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const ctx = await aiContext();
    const p = PRICES["muse-spark-1.3"];
    const r = await reserve(ctx, sessionId, "muse-spark-1.3", "/responses identify", 3000 * p.input + 2500 * p.output);
    try {
      const { parsed, usage } = await responsesJson(
        {
          model: "muse-spark-1.3",
          reasoning: { effort: "low" },
          // Reasoning tokens count toward this limit; too low and the JSON gets cut off.
          max_output_tokens: 2500,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: ask },
                { type: "input_image", image_url: image },
              ],
            },
          ],
        },
        "product_identity",
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
