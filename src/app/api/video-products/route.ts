// The products of a sales video, from the moments the phone was held still (see scanProducts in
// src/lib/catalog/video.ts): one look at all of them together says which show the same product,
// filmed again from another side, and names each product once. Looked at one by one, the same pot
// came out as three products with three names. What the seller says goes with the photos: a pack
// ("all this with the bag for 199 dh") is said, not seen. Its items keep their own names and share
// the pack's name, so the merchant sees what the pack holds.

import { NextResponse } from "next/server";
import type { VideoProduct } from "@/lib/catalog/video";
import type { Spoken } from "@/lib/server/extract";
import { aiContext, errorResponse, isJpegPhoto, responsesJson } from "@/lib/server/meta";
import { chatCost, PRICES, spend } from "@/lib/server/usage";

// `moments`: the second of the video each photo was taken at.
type Body = { sessionId: string; photos: string[]; moments?: number[]; spoken?: Spoken[] };

const MAX_PHOTOS = 12;
const MAX_SPOKEN = 40_000; // about 10 minutes of speech, as /api/extract

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["products"],
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["photos", "name_fr", "for_sale", "pack_fr"],
        properties: {
          photos: { type: "array", items: { type: "integer" }, description: "Numbers of the photos that show this product" },
          name_fr: { type: "string", description: "Short shop title in French, with brand, flavor and size when readable" },
          for_sale: { type: "boolean", description: "false for a table, floor, wall, hand or anything that is not a product" },
          pack_fr: { type: "string", description: "Name of the pack this item is sold in, the same for every item of that pack; empty when sold on its own" },
        },
      },
    },
  },
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, photos } = body;
  const moments = Array.isArray(body.moments) ? body.moments : [];
  const spoken = Array.isArray(body.spoken) ? body.spoken : [];
  if (
    !sessionId ||
    !Array.isArray(photos) ||
    !photos.length ||
    photos.length > MAX_PHOTOS ||
    !photos.every((s) => isJpegPhoto(s)) ||
    !moments.every((m) => typeof m === "number") ||
    !spoken.every((s) => typeof s?.at === "number" && typeof s?.text === "string") ||
    spoken.reduce((n, s) => n + s.text.length, 0) > MAX_SPOKEN
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const said = spoken.map((s) => `[${Math.round(s.at)}s] ${s.text}`).join("\n");

  try {
    const ctx = await aiContext();
    const ask = [
      `These ${photos.length} numbered photos come from one sales video of a small shop in Morocco, each taken when the phone was held still.`,
      "The same item is often filmed several times, from another side, closer, or in another hand: put all its photos in one product, even when they look different.",
      "Items the seller offers together for one price (a box, a set, a pack, or all of this for one price, said or written on screen) form a pack: each item stays its own product with its own name, and all of them get the same pack_fr, the pack's name as a shop would list it, without its price. A product sold on its own has an empty pack_fr.",
      "Signs of a pack: the items are put together into one box, basket or bag on camera; one price stays written on screen while several items are shown one after another; the seller says all this, everything, the whole box or the whole set.",
      "Items each shown with their own price, like a flyer or a catalog page, are sold one by one: separate products with an empty pack_fr. So are colors or sizes of one item when each is sold on its own.",
      "Every photo belongs to exactly one product. Name each product as a shop would list it, reading the brand, flavor and size printed on it; name a brand only if you can read it.",
      "A photo of a table, a floor, a wall or a hand alone is not for sale.",
      said ? `What the seller says, with the second it is said:\n${said}` : "The video has no speech.",
    ].join(" ");
    const p = PRICES["muse-spark-1.3"];
    const { result } = await spend(
      ctx,
      sessionId,
      "muse-spark-1.3",
      "/responses video-products",
      photos.length * 1200 * p.input + 3000 * p.output,
      () =>
        responsesJson(
          {
            model: "muse-spark-1.3",
            reasoning: { effort: "low" },
            max_output_tokens: 3000,
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: ask },
                  ...photos.flatMap((url, i) => [
                    { type: "input_text", text: moments[i] != null ? `Photo ${i + 1} (at ${Math.round(moments[i])}s):` : `Photo ${i + 1}:` },
                    { type: "input_image", image_url: url },
                  ]),
                ],
              },
            ],
          },
          "video_products",
          SCHEMA,
        ),
      ({ usage }) => ({ usd: chatCost(usage), detail: { inputTokens: usage.prompt_tokens ?? 0 } }),
    );
    if (!result.parsed) return NextResponse.json({ error: "no_result" }, { status: 502 });
    return NextResponse.json({ products: (result.parsed as { products: VideoProduct[] }).products });
  } catch (err) {
    return errorResponse(err);
  }
}
