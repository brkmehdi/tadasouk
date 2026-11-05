// A Facebook and Instagram ad for one product, written by muse-spark-1.3: the main text in
// French, Darija (Latin letters) and Arabic, a headline, the button, who to show it to (around the
// store's city) and a daily budget in the store's currency. Text only: the product's name,
// category, description and price go in, no photo. About 15 s and under a cent (tested 2026-11-03).
// Nothing is published here: the merchant edits the texts in the app, and publishing waits for
// their Meta Ads account to be connected.

import { NextResponse } from "next/server";
import { withDb } from "@/lib/server/db";
import { aiContext, errorResponse, responsesJson } from "@/lib/server/meta";
import { chatCost, PRICES, reserve, settle } from "@/lib/server/usage";

type Body = { sessionId: string; productId: string };
export type AdDraft = {
  primary_fr: string;
  primary_darija: string;
  primary_ar: string;
  headline: string;
  cta: "SHOP_NOW" | "SEND_WHATSAPP_MESSAGE";
  audience: { city: string; radius_km: number; age_min: number; age_max: number; interests: string[] };
  daily_budget: number;
  why: string;
};
type Row = {
  name: string;
  description: string | null;
  category: string | null;
  price: string | null;
  compare_at_price: string | null;
  store_name: string;
  city: string | null;
  currency: string;
  whatsapp: string | null;
  cod_enabled: boolean;
};

const schema = (ctas: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["primary_fr", "primary_darija", "primary_ar", "headline", "cta", "audience", "daily_budget", "why"],
  properties: {
    primary_fr: { type: "string" },
    primary_darija: { type: "string" },
    primary_ar: { type: "string" },
    headline: { type: "string" },
    cta: { type: "string", enum: ctas },
    audience: {
      type: "object",
      additionalProperties: false,
      required: ["city", "radius_km", "age_min", "age_max", "interests"],
      properties: {
        city: { type: "string" },
        radius_km: { type: "integer" },
        age_min: { type: "integer" },
        age_max: { type: "integer" },
        interests: { type: "array", items: { type: "string" } },
      },
    },
    daily_budget: { type: "integer" },
    why: { type: "string" },
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));
const cut = (s: string, n: number) => s.replace(/[—–]/g, ",").trim().slice(0, n);

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const { sessionId, productId } = body;
  if (!sessionId || typeof sessionId !== "string" || !UUID.test(productId ?? "")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const ctx = await aiContext();
    // Only a product of the signed-in merchant's own store.
    const [p] = await withDb(
      (sql) => sql<Row[]>`
        select p.name, p.description, p.category, p.price, p.compare_at_price,
               s.name as store_name, s.city, s.currency, s.whatsapp, s.cod_enabled
        from public.products p join public.stores s on s.id = p.store_id
        where p.id = ${productId}::uuid and s.owner_id = ${ctx.userId}::uuid and p.status <> 'archived'`,
    );
    if (!p) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const ctas = p.whatsapp ? ["SHOP_NOW", "SEND_WHATSAPP_MESSAGE"] : ["SHOP_NOW"];
    const cur = p.currency === "EUR" ? "EUR" : "MAD (dirhams)";
    const facts = [
      `Product: ${p.name || "(no name)"}`,
      p.category ? `Category: ${p.category}` : null,
      p.description ? `Description: ${p.description.slice(0, 600)}` : null,
      p.price != null ? `Price: ${Number(p.price)} ${cur}` : "Price: not set",
      p.compare_at_price != null && p.price != null && Number(p.compare_at_price) > Number(p.price)
        ? `Was: ${Number(p.compare_at_price)} ${cur} (on sale)`
        : null,
      `Shop: ${p.store_name}, ${p.city || "Morocco"}`,
      p.cod_enabled ? "Customers pay cash on delivery." : null,
      p.whatsapp ? "Customers can order by WhatsApp." : null,
    ].filter(Boolean);
    const ask =
      "Write one Facebook and Instagram ad for a small Moroccan shop, for the product below.\n\n" +
      facts.join("\n") +
      "\n\nRules: primary_fr in French, primary_darija in Moroccan Darija written in Latin letters (the way people text, " +
      "e.g. \"Dyal\", \"bzaf\", \"daba\"), primary_ar in Moroccan Arabic script. Each primary text: 1 to 3 short lines, " +
      "concrete (what it is, the price, cash on delivery when true), at most 2 emojis, no hashtags, no dash marks, nothing " +
      "the facts above do not say (no invented discount, stock or delivery time). headline: French, at most 40 characters. " +
      `cta: ${ctas.join(" or ")} (WhatsApp when the product is better sold by conversation). audience: the shop's city ` +
      "(or the nearest big city), a radius in km (5 to 40), an age range (18 to 65), 3 to 5 Facebook interest names in English. " +
      `daily_budget: a sensible starting daily budget in ${cur}, as an integer (a small shop: ${p.currency === "EUR" ? "5 to 30" : "30 to 200"}). ` +
      "why: one short French sentence on why this audience.";

    const pr = PRICES["muse-spark-1.3"];
    const r = await reserve(ctx, sessionId, "muse-spark-1.3", "/responses ads", 1500 * pr.input + 4000 * pr.output);
    try {
      const { parsed, usage } = await responsesJson<AdDraft>(
        {
          model: "muse-spark-1.3",
          reasoning: { effort: "low" },
          max_output_tokens: 4000,
          input: [{ role: "user", content: [{ type: "input_text", text: ask }] }],
        },
        "ad_draft",
        schema(ctas),
      );
      const entry = await settle(r, chatCost(usage), true, { outputTokens: usage.completion_tokens ?? 0 });
      if (!parsed) return NextResponse.json({ error: "no_result" }, { status: 502 });
      const lo = p.currency === "EUR" ? 2 : 20;
      const ad: AdDraft = {
        primary_fr: cut(parsed.primary_fr, 500),
        primary_darija: cut(parsed.primary_darija, 500),
        primary_ar: cut(parsed.primary_ar, 500),
        headline: cut(parsed.headline, 60),
        cta: ctas.includes(parsed.cta) ? parsed.cta : "SHOP_NOW",
        audience: {
          city: cut(parsed.audience.city || p.city || "Casablanca", 60),
          radius_km: clamp(parsed.audience.radius_km, 1, 80),
          age_min: clamp(parsed.audience.age_min, 18, 65),
          age_max: clamp(Math.max(parsed.audience.age_max, parsed.audience.age_min), 18, 65),
          interests: parsed.audience.interests.slice(0, 6).map((i) => cut(i, 40)),
        },
        daily_budget: clamp(parsed.daily_budget, lo, lo * 25),
        why: cut(parsed.why, 200),
      };
      return NextResponse.json({ ad, latencyMs: entry.latencyMs });
    } catch (err) {
      await settle(r, 0, false);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
