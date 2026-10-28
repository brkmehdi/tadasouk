// A tap on the video: which whole product did the merchant mean? muse-spark-1.3 image
// grounding returns its box (0-1000 coordinates), so SAM gets a box around the whole product
// even when the finger landed on its label. About 2 s, a fraction of a cent.
// mode "held": the phone was held still on something the on-device detector does not know;
// `found` says whether the middle shows a product at all (not a wall, a floor or a face).

import { NextResponse } from "next/server";
import { aiContext, errorResponse, responsesJson } from "@/lib/server/meta";
import { chatCost, PRICES, reserve, settle } from "@/lib/server/usage";

type Body = { sessionId: string; image: string; point: { x: number; y: number }; mode?: "tap" | "held" };
type Located = { found: boolean; noun: string; x_min: number; y_min: number; x_max: number; y_max: number };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "noun", "x_min", "y_min", "x_max", "y_max"],
  properties: {
    found: { type: "boolean" },
    noun: { type: "string" },
    x_min: { type: "integer" },
    y_min: { type: "integer" },
    x_max: { type: "integer" },
    y_max: { type: "integer" },
  },
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, image, point } = body;
  const held = body.mode === "held";
  const inRange = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1000;
  if (
    !sessionId ||
    typeof image !== "string" ||
    !image.startsWith("data:image/jpeg;base64,") ||
    image.length > 600_000 ||
    !inRange(point?.x) ||
    !inRange(point?.y)
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const ask = held
    ? `A shop owner is holding the phone still to show one product to sell, in the middle of this photo ` +
      `(coordinates 0-1000, x from the left, y from the top). found: true only if the middle shows an ` +
      `item a shop could sell, held or standing there; false for a wall, a floor, an empty table or ` +
      `shelf, a person, or a blur. When found, return the whole product nearest the middle (not only ` +
      `its label or a part of it): a short English noun and its bounding box in the 0-1000 range.`
    : `A shop owner tapped the point (${Math.round(point.x)}, ${Math.round(point.y)}) of this photo ` +
      `(coordinates 0-1000, x from the left, y from the top) to select the product to sell. ` +
      `Return the whole product they mean (not only its label or a part of it): a short English noun ` +
      `and its bounding box in the 0-1000 range. found: false only if nothing sellable is there.`;

  try {
    const ctx = await aiContext();
    const p = PRICES["muse-spark-1.3"];
    const r = await reserve(ctx, sessionId, "muse-spark-1.3", "/responses locate", 2000 * p.input + 1500 * p.output);
    try {
      const { parsed, usage } = await responsesJson<Located>(
        {
          model: "muse-spark-1.3",
          reasoning: { effort: "minimal" },
          max_output_tokens: 1500,
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
        "located_product",
        SCHEMA,
      );
      const entry = await settle(r, chatCost(usage), true, { outputTokens: usage.completion_tokens ?? 0 });
      if (!parsed || !(parsed.x_max > parsed.x_min && parsed.y_max > parsed.y_min)) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      return NextResponse.json({ result: parsed, latencyMs: entry.latencyMs });
    } catch (err) {
      await settle(r, 0, false);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
