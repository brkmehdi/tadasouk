// Stock camera (/app tools): a phone fixed over the counter sends one frame when something new
// sits still in the middle and no barcode was read. muse-spark-1.3 gets the frame and the store's
// catalog as one numbered grid (built in the browser, as for /api/count) and says which product
// it is, how many units (a sale is usually 1, an opened delivery box can hold 24), where it is,
// and how sure it is. With `known` (a barcode was read during a delivery) the product is given
// and only the units are counted. The browser writes the stock movement with the merchant's session.

import { NextResponse } from "next/server";
import { MAX_CELLS, MAX_IMAGE } from "@/lib/catalog/count";
import { withDb } from "@/lib/server/db";
import { aiContext, errorResponse, responsesJson } from "@/lib/server/meta";
import { chatCost, PRICES, reserve, settle } from "@/lib/server/usage";

type Cell = { productId: string; colorId: string | null };
type Body = { sessionId: string; frame: string; grid: string; cells: Cell[]; mode: "sale" | "delivery"; known?: number };
type Seen = {
  item_present: boolean;
  product: number;
  count: number;
  confidence: number;
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["item_present", "product", "count", "confidence", "x_min", "y_min", "x_max", "y_max"],
  properties: {
    item_present: { type: "boolean" },
    product: { type: "integer" },
    count: { type: "integer" },
    confidence: { type: "integer" },
    x_min: { type: "integer" },
    y_min: { type: "integer" },
    x_max: { type: "integer" },
    y_max: { type: "integer" },
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
  const { sessionId, frame, grid, cells, mode, known } = body;
  if (
    !sessionId ||
    (mode !== "sale" && mode !== "delivery") ||
    !isJpeg(frame) ||
    !isJpeg(grid) ||
    !Array.isArray(cells) ||
    cells.length === 0 ||
    cells.length > MAX_CELLS ||
    !cells.every((c) => UUID.test(c?.productId ?? "") && (c.colorId === null || UUID.test(c.colorId))) ||
    (known !== undefined && !(Number.isInteger(known) && known >= 1 && known <= cells.length))
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const ctx = await aiContext();
    // Only the merchant's own products can be matched, each colour with its own product.
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

    const scene =
      mode === "sale"
        ? "A sale: the shop owner shows the item a customer is buying, held in a hand or put down in the middle. " +
          "count is the number of units of that product shown together (usually 1)."
        : "A delivery: units of one product just arrived, loose or in an opened carton. count is the number of units of that " +
          "product you can see; for a full carton whose units are visible, also use a quantity printed on it (for example 'x24' or '24 pcs').";
    const ask =
      "The FIRST image is a frame from a phone fixed above a shop counter (coordinates 0-1000, x from the left, y from the top). " +
      `The SECOND image is the shop's catalog: ${cells.length} products, each with its number in the black corner box. ` +
      scene +
      (known ? ` Its barcode was read: it is catalog product number ${known}; answer that product and count its units.` : "") +
      " Answer: item_present (is any product shown in the middle of the frame, not just the empty counter, a hand or the background); " +
      "product (the catalog number of the item in the middle, only if it is exactly that product: same brand, same flavour, same colour; " +
      "0 if it is none of them or you cannot tell); count (0 when product is 0); confidence (0-100, how sure you are that it is exactly " +
      "this catalog product); and the bounding box around the item(s) of that product (all zeros when product is 0).";
    const p = PRICES["muse-spark-1.3"];
    const r = await reserve(ctx, sessionId, "muse-spark-1.3", "/responses stockcam", 12000 * p.input + 6000 * p.output);
    try {
      const { parsed, usage } = await responsesJson<Seen>(
        {
          model: "muse-spark-1.3",
          reasoning: { effort: "low" },
          max_output_tokens: 6000,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: ask },
                { type: "input_image", image_url: frame },
                { type: "input_image", image_url: grid },
              ],
            },
          ],
        },
        "stock_camera",
        SCHEMA,
      );
      const entry = await settle(r, chatCost(usage), true, { outputTokens: usage.completion_tokens ?? 0 });
      if (!parsed) return NextResponse.json({ error: "no_result" }, { status: 502 });
      const clamp = (v: number) => Math.min(1000, Math.max(0, v)) / 1000;
      const index = known ?? parsed.product;
      const found = index >= 1 && index <= cells.length;
      const cell = found ? cells[index - 1] : null;
      const box =
        found && parsed.x_max > parsed.x_min && parsed.y_max > parsed.y_min
          ? { x: clamp(parsed.x_min), y: clamp(parsed.y_min), w: clamp(parsed.x_max) - clamp(parsed.x_min), h: clamp(parsed.y_max) - clamp(parsed.y_min) }
          : null;
      const most = mode === "sale" ? 20 : 500;
      return NextResponse.json({
        present: parsed.item_present || found,
        productId: cell?.productId ?? null,
        colorId: cell?.colorId ?? null,
        count: cell ? Math.min(most, Math.max(1, Math.round(parsed.count))) : 0,
        confidence: cell ? Math.min(1, Math.max(0, parsed.confidence / 100)) : 0,
        box,
        latencyMs: entry.latencyMs,
      });
    } catch (err) {
      await settle(r, 0, false);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
