// The store that listens: the merchant says (or types) what to change in the back office, and
// muse-spark-1.3 does it with tools, then says in one sentence what it did. Tools run here,
// with the merchant's own session, so row level security keeps every read and write to their
// store. Each change comes back with what it replaced, so the screen can undo it. Deleting
// products is never done here: the screen asks the merchant to confirm with a button.

import { NextResponse } from "next/server";
import { PRODUCT_COLUMNS, type CatalogProduct } from "@/lib/catalog/types";
import { serverSupabase } from "@/lib/server/auth";
import { aiContext, errorResponse, metaFetch } from "@/lib/server/meta";
import { chatCost, PRICES, reserve, settle } from "@/lib/server/usage";
import type { AgentAction, AgentAnswer, ClientStep, Undo } from "@/lib/store-agent";

type Turn = { role: "user" | "assistant"; content: string };
type Body = { sessionId?: string; text?: string; history?: Turn[] };

const MAX_ROUNDS = 4;
const MAX_COMPLETION_TOKENS = 1800;

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", additionalProperties: false, properties, required } },
});
const ids = { type: "array", items: { type: "string" }, description: "Product ids from the state." };
const money = { type: "number", minimum: 0 };
const moneyOrNull = { type: ["number", "null"], minimum: 0 };

const TOOLS = [
  fn(
    "update_products",
    "Change fields of one or more products. Only the fields given change. Use null to clear a field.",
    {
      product_ids: ids,
      name: { type: "string" },
      price: moneyOrNull,
      compare_at_price: { ...moneyOrNull, description: "The old price shown crossed out (a promotion). Must be above the price." },
      description: { type: "string" },
      category: { type: "string", description: "Short French category; reuse an existing one when it fits." },
      stock: { type: ["integer", "null"], minimum: 0 },
    },
    ["product_ids"],
  ),
  fn(
    "set_online",
    "Put products online (visible in the store) or take them back to draft.",
    { product_ids: ids, all_drafts: { type: "boolean", description: "true: every draft." }, online: { type: "boolean" } },
    ["online"],
  ),
  fn("set_sizes", "Replace the list of sizes of a product (empty list: one size).", { product_id: { type: "string" }, sizes: { type: "array", items: { type: "string" } } }, [
    "product_id",
    "sizes",
  ]),
  fn(
    "add_colors",
    "Add colours to a product.",
    {
      product_id: { type: "string" },
      colors: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { name: { type: "string", description: "French colour name" }, hex: { type: "string", description: "#rrggbb" } },
          required: ["name", "hex"],
        },
      },
    },
    ["product_id", "colors"],
  ),
  fn(
    "set_soldout",
    "Mark a size and/or colour of a product as sold out, or available again.",
    { product_id: { type: "string" }, color: { type: "string", description: "Colour name, if the product has colours." }, size: { type: "string" }, soldout: { type: "boolean" } },
    ["product_id", "soldout"],
  ),
  fn(
    "save_shipping_method",
    "Create a delivery method, or change the one with the same name.",
    {
      name: { type: "string" },
      price: money,
      free_over: { ...moneyOrNull, description: "Free when the order reaches this amount." },
      delay_days: { type: ["integer", "null"], minimum: 0 },
      active: { type: "boolean" },
    },
    ["name"],
  ),
  fn(
    "save_promo_code",
    "Create a promotion code, or change the one with the same code.",
    {
      code: { type: "string", description: "Uppercase letters and digits, 3 to 20." },
      kind: { type: "string", enum: ["percent", "amount"] },
      value: { type: "number", exclusiveMinimum: 0 },
      min_subtotal: money,
      active: { type: "boolean" },
    },
    ["code"],
  ),
  fn("update_store", "Change the store's settings.", {
    name: { type: "string" },
    tagline: { type: "string", description: "One line shown at the top of the store." },
    city: { type: "string" },
    cod_enabled: { type: "boolean", description: "Cash on delivery." },
    credit_enabled: { type: "boolean", description: "Customer credit." },
  }),
  fn("make_store_hero", "Generate a new banner photo for the store with AI (about 10 seconds).", {}),
  fn("sales_report", "Orders and revenue for a period.", { period: { type: "string", enum: ["today", "7d", "30d"] } }, ["period"]),
  fn("pending_orders", "Orders waiting to be confirmed or shipped.", {}),
  fn("delete_products", "Delete products. The merchant confirms with a button before anything is deleted.", { product_ids: ids }, ["product_ids"]),
];

const SYSTEM = `You are the assistant of a small online store in Morocco, inside its back office.
The merchant speaks or types in Darija, French, Arabic or English, often mixed, to change the store or ask about it.
You get the store's current state as JSON: the store, its products (newest first), delivery methods, promotion codes.
Make the changes with tools; call several tools at once when the request has several parts.
Never invent ids: find products by name, category, price or position ("le dernier" = the newest). Prices are in the store's currency.
Darija numbers: miya = 100, mitayn = 200, khamsin = 50, alf = 1000, "dirham"/"drahem" = DH.
If the request is unclear or matches several products you cannot tell apart, ask one short question instead of guessing.
After the tools, answer in one or two short sentences saying what you did or what you found, in the merchant's language (French when they speak Darija in Latin letters), addressing them as "vous". Plain text, no lists, no markdown.`;

type Db = Awaited<ReturnType<typeof serverSupabase>>;
type Ctx = { db: Db; storeId: string; store: Record<string, unknown>; products: CatalogProduct[]; actions: AgentAction[]; client: ClientStep[] };

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

async function run(ctx: Ctx, name: string, a: Record<string, unknown>): Promise<unknown> {
  const { db, storeId } = ctx;
  const byId = new Map(ctx.products.map((p) => [p.id, p]));
  const known = (list: unknown) => (Array.isArray(list) ? (list as string[]).filter((id) => byId.has(id)) : []);
  const names = (list: string[]) => list.map((id) => byId.get(id)?.name || "produit").join(", ");

  switch (name) {
    case "update_products": {
      const list = known(a.product_ids);
      const fields = pick(a, ["name", "price", "compare_at_price", "description", "category", "stock"]);
      if (!list.length || !Object.keys(fields).length) return { error: "no product or no field" };
      const undo: Undo[] = list.map((id) => ({ table: "products", id, before: pick(byId.get(id) as unknown as Record<string, unknown>, Object.keys(fields)) }));
      const { error } = await db.from("products").update(fields).in("id", list);
      if (error) return { error: error.message };
      ctx.actions.push({ label: `${names(list)} : ${Object.keys(fields).map(fieldLabel).join(", ")}`, undo });
      return { ok: true, updated: list.length };
    }
    case "set_online": {
      const online = a.online === true;
      const list = a.all_drafts ? ctx.products.filter((p) => p.status === "draft").map((p) => p.id) : known(a.product_ids);
      if (!list.length) return { error: "no product" };
      const undo: Undo[] = list.map((id) => ({ table: "products", id, before: { status: byId.get(id)!.status } }));
      const { error } = await db.from("products").update({ status: online ? "published" : "draft" }).in("id", list);
      if (error) return { error: error.message };
      if (online && !ctx.store.published) {
        await db.from("stores").update({ published: true }).eq("id", storeId);
        undo.push({ table: "stores", id: storeId, before: { published: false } });
        ctx.store.published = true;
      }
      ctx.actions.push({ label: `${online ? "En ligne" : "Retiré"} : ${names(list)}`, undo });
      return { ok: true, count: list.length };
    }
    case "set_sizes": {
      const p = byId.get(String(a.product_id));
      if (!p) return { error: "unknown product" };
      const sizes = [...new Set((a.sizes as string[]).map((s) => String(s).trim().toUpperCase()).filter(Boolean))].slice(0, 20);
      const { error } = await db.from("products").update({ sizes }).eq("id", p.id);
      if (error) return { error: error.message };
      ctx.actions.push({ label: `${p.name} : tailles ${sizes.join(", ") || "unique"}`, undo: [{ table: "products", id: p.id, before: { sizes: p.sizes } }] });
      return { ok: true };
    }
    case "add_colors": {
      const p = byId.get(String(a.product_id));
      if (!p) return { error: "unknown product" };
      const have = p.product_colors?.length ?? 0;
      const rows = (a.colors as { name: string; hex: string }[]).slice(0, 12).map((c, i) => ({
        product_id: p.id,
        store_id: storeId,
        name: String(c.name).trim().slice(0, 40),
        hex: /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "#cccccc",
        position: have + i,
      }));
      const { data, error } = await db.from("product_colors").insert(rows).select("id");
      if (error) return { error: error.message };
      ctx.actions.push({ label: `${p.name} : couleurs ${rows.map((r) => r.name).join(", ")}`, undo: (data ?? []).map((r) => ({ table: "product_colors", id: r.id, remove: true })) });
      return { ok: true };
    }
    case "set_soldout": {
      const p = byId.get(String(a.product_id));
      if (!p) return { error: "unknown product" };
      const color = a.color ? p.product_colors?.find((c) => c.name.toLowerCase() === String(a.color).toLowerCase()) : null;
      if (a.color && !color) return { error: "unknown colour" };
      const size = a.size ? String(a.size).trim().toUpperCase() : null;
      const colorIds = color ? [color.id] : p.product_colors?.length ? p.product_colors.map((c) => c.id) : [null];
      const sizes = size ? [size] : p.sizes.length ? p.sizes : [null];
      const keys = colorIds.flatMap((c) => sizes.map((s) => `${c ?? ""}:${s ?? ""}`));
      const next = a.soldout ? [...new Set([...p.soldout, ...keys])] : p.soldout.filter((k) => !keys.includes(k));
      const { error } = await db.from("products").update({ soldout: next }).eq("id", p.id);
      if (error) return { error: error.message };
      const what = [color?.name, size].filter(Boolean).join(" ") || "tout";
      ctx.actions.push({ label: `${p.name} ${what} : ${a.soldout ? "épuisé" : "disponible"}`, undo: [{ table: "products", id: p.id, before: { soldout: p.soldout } }] });
      return { ok: true };
    }
    case "save_shipping_method": {
      const name = String(a.name).trim().slice(0, 60);
      const { data: found } = await db.from("shipping_methods").select("id, name, price, free_over, delay_days, active").eq("store_id", storeId).ilike("name", name).maybeSingle();
      const fields = pick(a, ["price", "free_over", "delay_days", "active"]);
      if (found) {
        const { error } = await db.from("shipping_methods").update(fields).eq("id", found.id);
        if (error) return { error: error.message };
        ctx.actions.push({ label: `Livraison « ${found.name} » modifiée`, undo: [{ table: "shipping_methods", id: found.id, before: pick(found, Object.keys(fields)) }] });
      } else {
        if (a.price == null) return { error: "a new method needs a price" };
        const { data, error } = await db.from("shipping_methods").insert({ store_id: storeId, name, ...fields }).select("id").single();
        if (error) return { error: error.message };
        ctx.actions.push({ label: `Livraison « ${name} » ajoutée`, undo: [{ table: "shipping_methods", id: data.id, remove: true }] });
      }
      return { ok: true };
    }
    case "save_promo_code": {
      const code = String(a.code).toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
      if (code.length < 3) return { error: "code too short" };
      const { data: found } = await db.from("promo_codes").select("id, kind, value, min_subtotal, active").eq("store_id", storeId).eq("code", code).maybeSingle();
      const fields = pick(a, ["kind", "value", "min_subtotal", "active"]);
      if (found) {
        const { error } = await db.from("promo_codes").update(fields).eq("id", found.id);
        if (error) return { error: error.message };
        ctx.actions.push({ label: `Code ${code} modifié`, undo: [{ table: "promo_codes", id: found.id, before: pick(found, Object.keys(fields)) }] });
      } else {
        if (!a.kind || !a.value) return { error: "a new code needs kind and value" };
        const { data, error } = await db.from("promo_codes").insert({ store_id: storeId, code, ...fields }).select("id").single();
        if (error) return { error: error.message };
        ctx.actions.push({ label: `Code ${code} créé (-${a.value}${a.kind === "percent" ? " %" : " DH"})`, undo: [{ table: "promo_codes", id: data.id, remove: true }] });
      }
      return { ok: true };
    }
    case "update_store": {
      const fields = pick(a, ["name", "tagline", "city", "cod_enabled", "credit_enabled"]);
      if (!Object.keys(fields).length) return { error: "no field" };
      const { error } = await db.from("stores").update(fields).eq("id", storeId);
      if (error) return { error: error.message };
      ctx.actions.push({ label: `Boutique : ${Object.keys(fields).map(fieldLabel).join(", ")}`, undo: [{ table: "stores", id: storeId, before: pick(ctx.store, Object.keys(fields)) }] });
      Object.assign(ctx.store, fields);
      return { ok: true };
    }
    case "make_store_hero":
      ctx.client.push({ type: "hero" });
      return { ok: true, note: "The screen is making it now; it appears in about 10 seconds." };
    case "sales_report": {
      const days = a.period === "today" ? 0 : a.period === "7d" ? 6 : 29;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      since.setDate(since.getDate() - days);
      const { data } = await db.from("orders").select("total, status, payment_status").eq("store_id", storeId).gte("created_at", since.toISOString());
      const live = (data ?? []).filter((o) => o.status !== "cancelled");
      return {
        orders: live.length,
        revenue: live.reduce((n, o) => n + Number(o.total), 0),
        paid: live.filter((o) => o.payment_status === "paid").length,
        cancelled: (data ?? []).length - live.length,
        currency: ctx.store.currency,
      };
    }
    case "pending_orders": {
      const { data } = await db
        .from("orders")
        .select("number, status, total, customer_name, city, created_at")
        .eq("store_id", storeId)
        .in("status", ["pending", "confirmed"])
        .order("created_at")
        .limit(20);
      return { orders: data ?? [] };
    }
    case "delete_products": {
      const list = known(a.product_ids);
      if (!list.length) return { error: "no product" };
      ctx.client.push({ type: "confirm_delete", ids: list, names: list.map((id) => byId.get(id)?.name || "produit") });
      return { ok: true, note: "Nothing is deleted yet: tell the merchant to tap the red button « Supprimer ce produit » on screen to confirm." };
    }
  }
  return { error: "unknown tool" };
}

const LABELS: Record<string, string> = {
  name: "nom",
  price: "prix",
  compare_at_price: "prix barré",
  description: "description",
  category: "catégorie",
  stock: "stock",
  tagline: "phrase d'accroche",
  city: "ville",
  cod_enabled: "paiement à la livraison",
  credit_enabled: "crédit",
};
const fieldLabel = (k: string) => LABELS[k] ?? k;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 1000) : "";
  if (!b.sessionId || !text) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const history = (Array.isArray(b.history) ? b.history : [])
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-6)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 600) }));

  try {
    const ai = await aiContext();
    const db = await serverSupabase();
    const { data: store } = await db
      .from("stores")
      .select("id, name, slug, city, tagline, currency, published, cod_enabled, credit_enabled")
      .eq("owner_id", ai.userId)
      .maybeSingle();
    if (!store) return NextResponse.json({ error: "no_store" }, { status: 403 });
    const [{ data: products }, { data: shipping }, { data: promos }] = await Promise.all([
      db.from("products").select(PRODUCT_COLUMNS).eq("store_id", store.id).neq("status", "archived").order("created_at", { ascending: false }).limit(150),
      db.from("shipping_methods").select("name, price, free_over, delay_days, active").eq("store_id", store.id),
      db.from("promo_codes").select("code, kind, value, min_subtotal, active, uses").eq("store_id", store.id),
    ]);
    const ctx: Ctx = { db, storeId: store.id, store, products: (products ?? []) as CatalogProduct[], actions: [], client: [] };
    const state = {
      store: pick(store, ["name", "city", "tagline", "currency", "published", "cod_enabled", "credit_enabled"]),
      products: ctx.products.map((p) => ({
        id: p.id,
        name: p.name || "(sans nom)",
        price: p.price,
        compare_at_price: p.compare_at_price,
        category: p.category,
        status: p.status,
        stock: p.stock,
        sizes: p.sizes,
        colors: p.product_colors?.map((c) => c.name),
        soldout: p.soldout.length ? p.soldout.length : undefined,
      })),
      shipping: shipping ?? [],
      promo_codes: promos ?? [],
      today: new Date().toISOString().slice(0, 10),
    };

    const messages: Record<string, unknown>[] = [
      { role: "system", content: SYSTEM },
      { role: "system", content: `State: ${JSON.stringify(state)}` },
      ...history,
      { role: "user", content: text },
    ];
    const p = PRICES["muse-spark-1.3"];
    let reply = "";
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const estimate = (JSON.stringify(messages).length / 3 + 2500) * p.input + MAX_COMPLETION_TOKENS * p.output;
      const r = await reserve(ai, b.sessionId, "muse-spark-1.3", "/chat/completions store-agent", estimate);
      let message: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } | undefined;
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
            tool_choice: round === MAX_ROUNDS - 1 ? "none" : "auto",
            parallel_tool_calls: true,
            messages,
          }),
        });
        const data = (await res.json()) as { choices?: { message?: typeof message }[]; usage?: Parameters<typeof chatCost>[0] };
        message = data.choices?.[0]?.message;
        await settle(r, chatCost(data.usage), true, { round, calls: message?.tool_calls?.length ?? 0 });
      } catch (err) {
        await settle(r, 0, false);
        throw err;
      }
      const calls = message?.tool_calls ?? [];
      if (!calls.length) {
        reply = (message?.content ?? "").trim();
        break;
      }
      messages.push({ role: "assistant", content: message?.content ?? "", tool_calls: calls });
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // a malformed call gets an error result; the model can try again
        }
        const result = await run(ctx, call.function.name, args).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "failed" }));
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    const answer: AgentAnswer = { reply: reply || (ctx.actions.length ? "C'est fait." : ""), actions: ctx.actions, client: ctx.client };
    return NextResponse.json(answer);
  } catch (err) {
    return errorResponse(err);
  }
}
