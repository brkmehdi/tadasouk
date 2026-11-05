// Rates all the photos of one product in one request, so the model compares them with each other:
// the merchant's real photo, the AI photo and the photos from shops. The first photo is the
// reference. Besides quality, each gets a fidelity: how surely it shows that exact product.

import { Buffer } from "node:buffer";
import { responsesJson } from "./meta";
import { fetchWebImage } from "./web-image";

const ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["photo", "score", "fidelity", "sharpness", "lighting", "framing", "background", "note"],
  properties: {
    photo: { type: "integer", description: "The image's number" },
    score: { type: "integer", description: "Overall 0-100 as a product photo for an online shop" },
    fidelity: { type: "integer", description: "0-10: how surely this is the exact product of image 1" },
    sharpness: { type: "integer", description: "0-10" },
    lighting: { type: "integer", description: "0-10" },
    framing: { type: "integer", description: "0-10: product whole, centered, filling the frame" },
    background: { type: "integer", description: "0-10: clean and not distracting" },
    note: { type: "string", description: "One short sentence in French: the main thing to improve, or why it is good" },
  },
};

const SCHEMA = { type: "object", additionalProperties: false, required: ["photos"], properties: { photos: { type: "array", items: ITEM } } };

export type Score = { photo: number; score: number; fidelity: number; sharpness: number; lighting: number; framing: number; background: number; note: string };

// A web address becomes the image itself: the model refuses some sites, and one refusal would
// fail the whole request. A site that does not answer is left out.
async function inline(photo: string) {
  if (photo.startsWith("data:")) return photo;
  const got = await fetchWebImage(photo);
  return got && `data:${got.type};base64,${Buffer.from(got.bytes).toString("base64")}`;
}

// Answers in the order of `photos`, null for a photo that could not be read.
export async function scorePhotos(photos: string[], name?: string | null) {
  const images = await Promise.all(photos.map(inline));
  const kept = images.flatMap((image, at) => (image ? [{ image, at }] : []));
  const ask = [
    `These ${kept.length} images are numbered 1 to ${kept.length} in order. Image 1 is the merchant's real photo of the product${name ? ` (${name})` : ""}.`,
    "score: rate each image as a product photo for an online shop, comparing them with each other. Only the photo quality counts here. Be strict.",
    "fidelity: is this exactly the same product as image 1? Same brand, variant, colour, shape and label. 10: certain. At most 3 for a similar product of another brand or variant. 0: another product. Image 1 gets 10.",
  ].join("\n");
  const { parsed, usage } = await responsesJson<{ photos: Score[] }>(
    {
      model: "muse-spark-1.3",
      reasoning: { effort: "minimal" },
      max_output_tokens: 2500,
      input: [{ role: "user", content: [{ type: "input_text", text: ask }, ...kept.map((k) => ({ type: "input_image", image_url: k.image }))] }],
    },
    "photo_scores",
    SCHEMA,
  );
  const results: (Score | null)[] = photos.map(() => null);
  kept.forEach((k, i) => {
    results[k.at] = parsed?.photos.find((s) => s.photo === i + 1) ?? null;
  });
  return { results, usage, read: parsed != null };
}
