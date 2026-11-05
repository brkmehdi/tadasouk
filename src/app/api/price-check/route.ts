// Product research: muse-spark-1.3 looks at the photo, searches the web from Morocco, and
// returns what the product exactly is (name, description, category) and its prices there:
// lowest, average, highest and a suggested price, with sources.
//
// Left free, the model ran 16 searches and read 200,000 tokens for each product ($0.17), and more
// searches found nothing better. It now gets 6 searches (measured 2026-11-01: $0.04, same shops,
// same prices). A barcode the shared catalog has priced is answered at no cost.

import { NextResponse } from "next/server";
import { findByBarcode, remember, reusedResearch, sameProduct } from "@/lib/server/catalog";
import { aiContext, errorResponse, responsesJson } from "@/lib/server/meta";
import { checkedSources } from "@/lib/server/pages";
import { productPages, realSources, sameItem } from "@/lib/server/sources";
import { chatCost, spend } from "@/lib/server/usage";

type Body = {
  sessionId: string;
  image?: string;
  name?: string | null;
  label?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string;
  barcode?: string | null;
};

const SEARCH_PRICE = 2.5 / 1000; // per web search query, docs/pricing-rate-limits
const ESTIMATE_USD = 0.08; // worst case held against the caps while the check runs
const MAX_SEARCHES = 6;
const PHOTO_PAGES = 6; // read to find at most 3 photos: some shops do not answer

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "product",
    "exact",
    "name_fr",
    "name_ar",
    "description_fr",
    "category",
    "currency",
    "low",
    "average",
    "high",
    "suggested",
    "verdict",
    "note",
    "sources",
  ],
  properties: {
    product: { type: "string", description: "What the product is, as identified" },
    exact: { type: "boolean", description: "true only when the pages found show this very product" },
    name_fr: { type: "string", description: "Shop title in French: brand, variant and size when known" },
    name_ar: { type: "string", description: "Same title in Arabic" },
    description_fr: { type: "string", description: "Two short factual sentences in French for the product page" },
    category: { type: "string", description: "One shop category in French, e.g. Épicerie, Beauté, Maison" },
    currency: { type: "string" },
    low: { type: ["number", "null"] },
    average: { type: ["number", "null"] },
    high: { type: ["number", "null"] },
    suggested: { type: ["number", "null"], description: "Competitive selling price for a small local shop" },
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
  const { sessionId, image, name, label, description, price, currency = "MAD", barcode } = body;
  if (!sessionId || (image && (!image.startsWith("data:image/jpeg;base64,") || image.length > 600_000))) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!image && !name) {
    return NextResponse.json({ error: "bad_request", message: "Need a photo or a name" }, { status: 400 });
  }

  const ask = [
    name ? `Product name: ${name}.` : "Identify the exact product from the photo (brand, variant, size).",
    barcode ? `Its barcode is ${barcode}.` : "",
    label ? `On-device detector label: ${label}.` : "",
    description ? `Merchant description: ${description}.` : "",
    price != null ? `The merchant sells it for ${price} ${currency}.` : "The merchant has not set a price yet.",
    `Search current retail prices for this product in Morocco (supermarkets, online shops, marketplaces).`,
    `Return the lowest, average and highest price you found in ${currency}, and a suggested selling price that is competitive for a small local shop (round number).`,
    `Add a verdict on the merchant price (unknown if none), a short note, and up to 3 sources with their prices.`,
    `Sources must be pages of this exact product in a shop (not a store home page, a category or a search page).`,
    `If you cannot find this exact product, use the closest comparable products and say so in the note.`,
    `Also give its shop title in French and Arabic, a two-sentence French description based on what you found, and a category.`,
    image
      ? `The photo shows the real product. Describe what the photo shows: results about another kind of product, such as a toy or a miniature of it, are not this product.`
      : "",
    `exact is true only if the pages you found show this very product.`,
    `Write the note in French.`,
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const ctx = await aiContext();
    // The same barcode is the same product, whoever sells it: its research needs no new search.
    // The verdict and the note depend on the merchant's own price, so a priced product is searched.
    const listed = currency === "MAD" && price == null ? await findByBarcode(barcode).catch(() => null) : null;
    const known = listed && sameItem(listed, name) ? reusedResearch(listed) : null;
    if (known) return NextResponse.json({ result: known, latencyMs: 0, cached: true });
    const { result, entry } = await spend(
      ctx,
      sessionId,
      "muse-spark-1.3",
      "/responses web_search",
      ESTIMATE_USD,
      () =>
        responsesJson<{
          exact: boolean;
          name_fr: string;
          category: string;
          currency: string;
          note: string;
          low: number | null;
          high: number | null;
          sources: { title: string; url: string; price: number | null }[];
          photoPages?: string[];
        }>(
          {
            model: "muse-spark-1.3",
            reasoning: { effort: "low" },
            max_tool_calls: MAX_SEARCHES,
            include: ["web_search_call.results"],
            tools: [{ type: "web_search", search_context_size: "low", user_location: { type: "approximate", country: "MA" } }],
            input: [
              {
                role: "user",
                content: [{ type: "input_text", text: ask }, ...(image ? [{ type: "input_image", image_url: image }] : [])],
              },
            ],
          },
          "price_check",
          SCHEMA,
        ),
      ({ searches, usage }) => ({
        usd: chatCost(usage) + searches * SEARCH_PRICE,
        detail: {
          searches,
          inputTokens: usage.prompt_tokens ?? 0,
          cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
        },
      }),
    );
    // Settled: what follows (checking the links, sharing the result) cannot change the bill.
    const { parsed, found } = result;
    if (!parsed) {
      return NextResponse.json({ error: "no_result", message: "Pas de prix trouvé" }, { status: 502 });
    }
    const cited = realSources(parsed.sources, found);
    const pages = productPages(found, `${parsed.name_fr} ${name ?? ""}`, PHOTO_PAGES);
    // Only pages opened and seen to name the product. The prices stay even when their page goes:
    // the search read them, and an app like Glovo shows no product to a plain request.
    parsed.sources = await checkedSources(cited, pages, parsed.name_fr || name || "").catch(() => []);
    parsed.photoPages = []; // the shop photos come from the pages that passed, nothing else
    // Shared with every shop: only an exact product, in dirhams, from pages its search returned, and
    // nothing written about this merchant's own price.
    if (barcode && parsed.exact && parsed.low != null && currency === "MAD" && parsed.currency === "MAD" && cited.length) {
      if (await sameProduct(barcode, parsed.name_fr).catch(() => false)) {
        const research = { ...parsed, verdict: "unknown", note: price == null ? parsed.note : "" };
        await remember({ barcode, name: parsed.name_fr, category: parsed.category, low: parsed.low, high: parsed.high, research }).catch(() => {});
      }
    }
    return NextResponse.json({ result: parsed, latencyMs: entry.latencyMs });
  } catch (err) {
    return errorResponse(err);
  }
}
