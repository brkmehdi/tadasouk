// The cart as the database prices it (quote_cart): which lines can be ordered, the promotion,
// the delivery methods with their fee, the total. The cart, cart page and checkout show this;
// the order is priced again by place_order.

import { NextResponse } from "next/server";
import postgres from "postgres";
import { cleanItems, UUID } from "@/lib/server/cart";
import { withDb } from "@/lib/server/db";
import type { Quote } from "@/lib/shop";

type Body = { slug?: string; items?: unknown; shipping?: string | null; promo?: string | null };

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const items = cleanItems(b.items);
  const shipping = b.shipping && UUID.test(b.shipping) ? b.shipping : null;
  const promo = typeof b.promo === "string" ? b.promo.slice(0, 30) : null;
  if (typeof b.slug !== "string" || !items) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const quote = await withDb(async (sql) => {
      const [r] = await sql<{ q: Quote }[]>`select public.quote_cart(${b.slug!}, ${sql.json(items)}, ${shipping}, ${promo}) as q`;
      return r.q;
    });
    return NextResponse.json(quote);
  } catch (err) {
    if (err instanceof postgres.PostgresError && err.code === "P0404") return NextResponse.json({ error: "not_found" }, { status: 404 });
    console.error("quote failed", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
