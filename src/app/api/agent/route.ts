// One transcript chunk + the live session state -> tool calls from muse-spark-1.3.
// The agent never writes prose to the merchant; it only calls tools. The browser applies
// the calls to its session state, so this route stays stateless.

import { NextResponse } from "next/server";
import { errorResponse, metaFetch, serverEnv } from "@/lib/server/meta";
import { chatCost, PRICES, reserve, settle } from "@/lib/server/usage";

export type AgentProduct = {
  id: string;
  name: string | null;
  label: string | null;
  color: string | null;
  price: number | null;
  compareAtPrice: number | null;
  quantity: number | null;
  description: string | null;
  photos: number;
  suggestedPrice: number | null;
};

export type AgentState = {
  currency: string;
  currentId: string | null;
  products: AgentProduct[];
  recent: string[];
  openQuestion: { productId: string; text: string } | null;
};

type Body = { sessionId: string; transcript: string; state: AgentState };

const MAX_COMPLETION_TOKENS = 600;

const ref = {
  type: "string",
  description: "Product id from the session state. Resolve 'this one'/'hada' to the current product, 'the previous one' to the one captured before it, 'the red one' by color or name.",
};

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

const TOOLS = [
  fn(
    "create_product",
    "Add a product the merchant describes by voice that was not captured on camera.",
    {
      name: { type: "string" },
      price: { type: "number" },
      quantity: { type: "integer" },
    },
    ["name"],
  ),
  fn(
    "set_price",
    "Set the selling price. Use the store currency unless the merchant names another (euro -> EUR, dirham/drahem -> MAD).",
    { product_id: ref, amount: { type: "number" }, currency: { type: "string", enum: ["MAD", "EUR"] } },
    ["product_id", "amount"],
  ),
  fn(
    "apply_discount",
    "Discount a product. 'percent' takes 0-100; 'amount' is money off in the store currency. 'make it 80' after a price is set is a new price, not a discount: use set_price.",
    { product_id: ref, kind: { type: "string", enum: ["percent", "amount"] }, value: { type: "number" } },
    ["product_id", "kind", "value"],
  ),
  fn("rename_product", "Give a product a name.", { product_id: ref, name: { type: "string" } }, ["product_id", "name"]),
  fn(
    "set_quantity",
    "Set how many units are in stock.",
    { product_id: ref, quantity: { type: "integer" } },
    ["product_id", "quantity"],
  ),
  fn(
    "set_description",
    "Set the product description the merchant dictates. Keep their words, fix only obvious transcription slips.",
    { product_id: ref, description: { type: "string" } },
    ["product_id", "description"],
  ),
  fn(
    "find_better_photos",
    "The merchant wants nicer photos of a product ('find better images', 'chouf lia tswira mzyana').",
    { product_id: ref },
    ["product_id"],
  ),
  fn(
    "check_price",
    "The merchant asks whether a price is competitive, or what the product sells for elsewhere.",
    { product_id: ref },
    ["product_id"],
  ),
  fn("remove_product", "Remove a product from the store.", { product_id: ref }, ["product_id"]),
  fn("undo_last", "Undo the previous change.", {}, []),
  fn(
    "ask_merchant",
    "Use when you cannot tell which product or what value the merchant means. Ask one short question in the language the merchant used.",
    { product_id: { ...ref, description: "Product the question is about, if any." }, question: { type: "string" } },
    ["question"],
  ),
];

const SYSTEM = `You run the voice controls of a shop being built live on a phone in Morocco.
The merchant films products and talks in Darija, French, Arabic or English, often mixed.
You receive one transcript chunk and the session state. Respond ONLY with tool calls.
If the chunk is small talk or not about the products, call no tool and reply with an empty message.
"this one", "hada", "hadi", "celui-ci" mean the current product. "the previous one", "lli 9bel" mean the product captured just before it.
Numbers can be spoken in Darija (miya = 100, mitayn = 200, khamsin = 50, alf = 1000) or French.
Never invent a product id; use ids from the state. If you are unsure, call ask_merchant.
The state may carry an openQuestion the app just asked the merchant (for example the price, with a suggestedPrice on that product). A short "oui", "wakha", "ok" or "yes" answers it: for a price question, call set_price with the suggestedPrice of that product. A number answers it with that number.`;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, transcript, state } = body;
  if (!sessionId || !transcript?.trim() || !state) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const user = JSON.stringify({ transcript: transcript.slice(0, 1000), state });
  const p = PRICES["muse-spark-1.3"];
  const estimate = ((SYSTEM.length + user.length) / 3 + 1500) * p.input + MAX_COMPLETION_TOKENS * p.output;

  try {
    const { caps } = serverEnv();
    const r = reserve(caps, sessionId, "muse-spark-1.3", "/chat/completions", estimate);
    try {
      const res = await metaFetch("/chat/completions", {
        method: "POST",
        accept: "application/json",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "muse-spark-1.3",
          reasoning_effort: "low",
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          tools: TOOLS,
          tool_choice: "auto",
          parallel_tool_calls: true,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: user },
          ],
        }),
      });
      const data = (await res.json()) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: { function: { name: string; arguments: string } }[];
          };
        }[];
        usage?: Parameters<typeof chatCost>[0] & { completion_tokens_details?: { reasoning_tokens?: number } };
      };
      const message = data.choices?.[0]?.message;
      const calls = (message?.tool_calls ?? []).map((c) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function.arguments || "{}");
        } catch {
          // A malformed call is dropped; the merchant can repeat the command.
        }
        return { name: c.function.name, args };
      });
      const entry = settle(r, chatCost(data.usage), true, {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        calls: calls.length,
      });
      return NextResponse.json({ calls, text: message?.content ?? "", latencyMs: entry.latencyMs });
    } catch (err) {
      settle(r, 0, false);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
