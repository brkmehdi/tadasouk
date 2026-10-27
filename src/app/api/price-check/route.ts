// "Is my price competitive?" muse-spark-1.3 looks at the product photo, searches the web
// from Morocco, and returns the lowest, average and highest price it found, with sources.

import { NextResponse } from "next/server";
import { errorResponse, metaFetch, serverEnv } from "@/lib/server/meta";
import { chatCost, reserve, settle } from "@/lib/server/usage";

type Body = {
  sessionId: string;
  image?: string;
  name?: string | null;
  label?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string;
};

const SEARCH_PRICE = 2.5 / 1000; // per web search query, docs/pricing-rate-limits
const ESTIMATE_USD = 0.15; // worst case held against the caps while the check runs

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["product", "currency", "low", "average", "high", "verdict", "note", "sources"],
  properties: {
    product: { type: "string", description: "What the product is, as identified" },
    currency: { type: "string" },
    low: { type: ["number", "null"] },
    average: { type: ["number", "null"] },
    high: { type: ["number", "null"] },
    verdict: { type: "string", enum: ["cheap", "fair", "expensive", "unknown"] },
    note: { type: "string", description: "One or two short sentences for the merchant" },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "price"],
        properties: { title: { type: "string" }, url: { type: "string" }, price: { type: ["number", "null"] } },
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
  const { sessionId, image, name, label, description, price, currency = "MAD" } = body;
  if (!sessionId || (image && (!image.startsWith("data:image/jpeg;base64,") || image.length > 600_000))) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!image && !name) {
    return NextResponse.json({ error: "bad_request", message: "Need a photo or a name" }, { status: 400 });
  }

  const ask = [
    name ? `Product name from the merchant: ${name}.` : "Identify the product from the photo.",
    label ? `On-device detector label: ${label}.` : "",
    description ? `Merchant description: ${description}.` : "",
    price != null ? `The merchant sells it for ${price} ${currency}.` : "The merchant has not set a price yet.",
    `Search current retail prices for this product in Morocco (supermarkets, online shops, marketplaces).`,
    `Return the lowest, average and highest price you found in ${currency}, a verdict on the merchant price, a short note, and up to 5 sources with their prices.`,
    `If you cannot find this exact product, use the closest comparable products and say so in the note.`,
    `Write the note in French.`,
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const { caps } = serverEnv();
    const r = reserve(caps, sessionId, "muse-spark-1.3", "/responses web_search", ESTIMATE_USD);
    try {
      const res = await metaFetch("/responses", {
        method: "POST",
        accept: "application/json",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "muse-spark-1.3",
          reasoning: { effort: "low" },
          tools: [{ type: "web_search", search_context_size: "low", user_location: { type: "approximate", country: "MA" } }],
          text: { format: { type: "json_schema", name: "price_check", strict: true, schema: SCHEMA } },
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: ask },
                ...(image ? [{ type: "input_image", image_url: image }] : []),
              ],
            },
          ],
        }),
      });
      const data = (await res.json()) as {
        output?: { type: string; content?: { type: string; text?: string }[] }[];
        usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
      };
      const searches = data.output?.filter((o) => o.type === "web_search_call").length ?? 0;
      const text = data.output
        ?.filter((o) => o.type === "message")
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === "output_text")
        .at(-1)?.text;
      const cost =
        chatCost({
          prompt_tokens: data.usage?.input_tokens,
          completion_tokens: data.usage?.output_tokens,
          prompt_tokens_details: { cached_tokens: data.usage?.input_tokens_details?.cached_tokens },
        }) +
        searches * SEARCH_PRICE;
      const entry = settle(r, cost, true, { searches, inputTokens: data.usage?.input_tokens ?? 0 });
      let result: unknown = null;
      try {
        result = text ? JSON.parse(text) : null;
      } catch {
        // Falls through to the error below.
      }
      if (!result) {
        return NextResponse.json({ error: "no_result", message: "Pas de prix trouvé" }, { status: 502 });
      }
      return NextResponse.json({ result, latencyMs: entry.latencyMs });
    } catch (err) {
      settle(r, 0, false);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
