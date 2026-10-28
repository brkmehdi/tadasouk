// Stock count from a shelf photo: muse-spark-1.3 gets the photo and the store's catalog as one
// numbered grid (built in the browser from the product photos), and returns a box for every item
// that is one of those products. About 10 s and 1 to 2 cents a photo. Tested on shop shelves:
// colours of the same bottle kept apart, products not on the shelf never matched; products that
// differ only by small print ("low sodium") can be confused, so the merchant checks the count.

import { NextResponse } from "next/server";
import { MAX_CELLS, MAX_IMAGE } from "@/lib/catalog/count";
import { withDb } from "@/lib/server/db";
import { aiContext, errorResponse, responsesJson } from "@/lib/server/meta";
import { chatCost, PRICES, reserve, settle } from "@/lib/server/usage";

type Cell = { productId: string; colorId: string | null };
type Body = { sessionId: string; shelf: string; grid: string; cells: Cell[] };
type Found = { matches: { product: number; x_min: number; y_min: number; x_max: number; y_max: number }[] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["matches"],
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["product", "x_min", "y_min", "x_max", "y_max"],
        properties: {
          product: { type: "integer" },
          x_min: { type: "integer" },
          y_min: { type: "integer" },
          x_max: { type: "integer" },
          y_max: { type: "integer" },
        },
      },
    },
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isJpeg = (s: unknown): s is string => typeof s === "string" && s.startsWith("data:image/jpeg;base64,") && s.length <= MAX_IMAGE;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, shelf, grid, cells } = body;
  if (
    !sessionId ||
    !isJpeg(shelf) ||
    !isJpeg(grid) ||
    !Array.isArray(cells) ||
    cells.length === 0 ||
    cells.length > MAX_CELLS ||
    !cells.every((c) => UUID.test(c?.productId ?? "") && (c.colorId === null || UUID.test(c.colorId)))
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const ctx = await aiContext();
    // Only the merchant's own products can be counted, each colour with its own product.
    const ids = [...new Set(cells.map((c) => c.productId))];
    const pairs = cells.filter((c) => c.colorId);
    const [owned, colors] = await withDb((sql) =>
      Promise.all([
        sql<{ id: string }[]>`
          select p.id from public.products p join public.stores s on s.id = p.store_id
          where s.owner_id = ${ctx.userId}::uuid and p.id in ${sql(ids)}`,
        pairs.length
          ? sql<{ id: string; product_id: string }[]>`
              select id, product_id from public.product_colors where id in ${sql(pairs.map((c) => c.colorId!))}`
          : Promise.resolve([]),
      ]),
    );
    const colorOk = pairs.every((c) => colors.some((k) => k.id === c.colorId && k.product_id === c.productId));
    if (owned.length !== ids.length || !colorOk) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const ask =
      "The FIRST image is a photo of a shop shelf (coordinates 0-1000, x from the left, y from the top). " +
      `The SECOND image is the shop's catalog: ${cells.length} products, each with its number in the black corner box. ` +
      "For every item on the shelf that is exactly one of the catalog products (same brand, same flavour, same colour; a different " +
      "colour or flavour of the same brand is NOT a match), return the product number and the item's bounding box. One box per item, " +
      "front row and items partly hidden behind it. Many catalog products may not be on this shelf. Items that match no catalog " +
      "product are ignored. Only box an item you can actually see; never fill an empty space.";
    const p = PRICES["muse-spark-1.3"];
    const r = await reserve(ctx, sessionId, "muse-spark-1.3", "/responses count", 12000 * p.input + 8000 * p.output);
    try {
      const { parsed, usage } = await responsesJson<Found>(
        {
          model: "muse-spark-1.3",
          reasoning: { effort: "low" },
          max_output_tokens: 12000,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: ask },
                { type: "input_image", image_url: shelf },
                { type: "input_image", image_url: grid },
              ],
            },
          ],
        },
        "shelf_count",
        SCHEMA,
      );
      const entry = await settle(r, chatCost(usage), true, { outputTokens: usage.completion_tokens ?? 0 });
      if (!parsed) return NextResponse.json({ error: "no_result" }, { status: 502 });
      const clamp = (v: number) => Math.min(1000, Math.max(0, v)) / 1000;
      const items = parsed.matches
        .filter((m) => m.product >= 1 && m.product <= cells.length && m.x_max > m.x_min && m.y_max > m.y_min)
        .map((m) => ({
          ...cells[m.product - 1],
          x: clamp(m.x_min),
          y: clamp(m.y_min),
          w: clamp(m.x_max) - clamp(m.x_min),
          h: clamp(m.y_max) - clamp(m.y_min),
        }));
      return NextResponse.json({ items, latencyMs: entry.latencyMs });
    } catch (err) {
      await settle(r, 0, false);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
