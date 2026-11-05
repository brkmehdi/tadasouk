// A photographed product -> its entry in the shared catalog. The search finds candidates by name;
// the model then compares their photos with the merchant's, because a name alone once turned a
// real car into a toy. No certain match: the product simply goes through the normal research.

import { Buffer } from "node:buffer";
import { searchCatalog } from "./catalog";
import { responsesJson } from "./meta";
import { fetchWebImage } from "./web-image";

const SURE = 8; // of 10: below this the product is treated as not found

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["match", "confidence"],
  properties: {
    match: { type: "integer", description: "The number of the catalog image showing the same product, 0 if none" },
    confidence: { type: "integer", description: "0-10: how sure it is the very same product" },
  },
};

// Null when no candidate has a readable photo: nothing to compare, and no model call to pay for.
export async function matchProduct(image: string, name: string) {
  const candidates = await searchCatalog(name).catch(() => []);
  const seen = await Promise.all(
    candidates.map(async (c) => {
      const got = c.image_url ? await fetchWebImage(c.image_url) : null;
      return got ? { c, picture: `data:${got.type};base64,${Buffer.from(got.bytes).toString("base64")}` } : null;
    }),
  );
  const shown = seen.flatMap((s) => (s ? [s] : []));
  if (!shown.length) return null;
  const { parsed, usage } = await responsesJson<{ match: number; confidence: number }>(
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
              text:
                `The first image is a merchant's photo of a product. The next ${shown.length} images are catalog entries, numbered 1 to ${shown.length}: ` +
                shown.map((s, i) => `${i + 1}. ${[s.c.brand, s.c.name, s.c.quantity].filter(Boolean).join(" ")}`).join("; ") +
                ". Is one of them the very same product: same brand, variant, flavour and packaging? A similar product of the same brand is not a match. Answer 0 if none.",
            },
            { type: "input_image", image_url: image },
            ...shown.map((s) => ({ type: "input_image", image_url: s.picture })),
          ],
        },
      ],
    },
    "catalog_match",
    SCHEMA,
  );
  const picked = parsed && parsed.confidence >= SURE ? (shown[parsed.match - 1]?.c ?? null) : null;
  return { product: picked, confidence: parsed?.confidence ?? 0, usage, compared: shown.map((s) => s.c.name) };
}
