// Reads a sales video from what the browser sends (what was said, and one picture of 12 frames)
// and lists the products on sale, so the merchant only has to confirm them.

import { responsesJson } from "./meta";

export type Spoken = { at: number; text: string };
export type Extracted = { products: { name: string; price: number | null; at: number }[] };

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
        required: ["name", "price", "at"],
        properties: {
          name: { type: "string", description: "Short shop title in French, with the brand and size when known" },
          price: { type: ["number", "null"], description: "The price said or written, null if there is none" },
          at: { type: "number", description: "The second where this product is best seen" },
        },
      },
    },
  },
};

export async function extractProducts(spoken: Spoken[], sheet: string, currency: string, seconds: number) {
  const said = spoken.map((s) => `[${Math.round(s.at)}s] ${s.text}`).join("\n");
  const ask = [
    "A seller in Morocco presents products for sale in a video. The image shows 12 frames of the video, each marked with its second.",
    said ? `What the seller says, with the second each part starts at (Darija, French, Arabic or English):\n${said}` : "The video has no speech.",
    `List each distinct product on sale, once, even when it is shown several times. Maximum 12.`,
    `name: what the product is. price: only a price actually said or written in the video, in ${currency}; never guess one.`,
    `at: the second, between 0 and ${Math.round(seconds)}, where the product is best seen, whole and facing the camera.`,
    `Never list furniture, hands, packaging tools or anything that is not for sale. If nothing is for sale, return an empty list.`,
  ].join("\n");
  return responsesJson<Extracted>(
    {
      model: "muse-spark-1.3",
      reasoning: { effort: "low" },
      max_output_tokens: 3000,
      input: [{ role: "user", content: [{ type: "input_text", text: ask }, { type: "input_image", image_url: sheet }] }],
    },
    "video_products",
    SCHEMA,
  );
}
