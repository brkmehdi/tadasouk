// An order from a public store. The cart only names products, colours, sizes and quantities: the
// database prices them (place_order, with the delivery method and the promotion code), numbers
// the order for the store, and keeps the customer for the merchant's next contact.

import { NextResponse } from "next/server";
import postgres from "postgres";
import { cleanItems, UUID } from "@/lib/server/cart";
import { withDb } from "@/lib/server/db";

type Body = {
  slug?: string;
  items?: unknown;
  name?: string;
  phone?: string;
  city?: string;
  address?: string;
  payment?: string;
  note?: string;
  shipping?: string | null;
  promo?: string | null;
};

const text = (v: unknown, min: number, max: number) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const items = cleanItems(b.items);
  if (
    !text(b.slug, 3, 40) ||
    !items?.length ||
    !text(b.name, 2, 80) ||
    !/^\d{9,15}$/.test(b.phone ?? "") ||
    !text(b.city, 2, 60) ||
    !text(b.address, 3, 300) ||
    (b.note != null && typeof b.note !== "string") ||
    (b.shipping != null && !UUID.test(b.shipping))
  ) {
    return NextResponse.json({ error: "bad_request", message: "Vérifiez le nom, le téléphone, la ville et l'adresse." }, { status: 400 });
  }
  const promo = typeof b.promo === "string" && b.promo.trim() ? b.promo.trim().slice(0, 30) : null;
  try {
    const row = await withDb(async (sql) => {
      const [r] = await sql<{ order_id: string; number: number; total: string }[]>`select * from public.place_order(
        ${b.slug!}, ${sql.json(items)},
        ${b.name!.trim()}, ${b.phone!}, ${b.city!.trim()}, ${b.address!.trim()}, ${b.payment ?? "cod"},
        ${(b.note ?? "").trim().slice(0, 300) || null}, ${b.shipping ?? null}, ${promo})`;
      return r;
    });
    return NextResponse.json({ id: row.order_id, number: row.number, total: Number(row.total) });
  } catch (err) {
    const code = err instanceof postgres.PostgresError ? err.code : null;
    if (code === "P0404") {
      return NextResponse.json({ error: "not_found", message: "Cette boutique n'est pas en ligne." }, { status: 404 });
    }
    if (code === "P0409") {
      return NextResponse.json({ error: "bad_promo", message: "Ce code promo ne fonctionne plus. Retirez-le et réessayez." }, { status: 400 });
    }
    if (code === "P0400") {
      return NextResponse.json(
        { error: "bad_order", message: "Un article du panier n'est plus disponible, ou la livraison a changé. Vérifiez le panier et réessayez." },
        { status: 400 },
      );
    }
    console.error("order failed", err);
    return NextResponse.json({ error: "internal", message: "La commande n'est pas passée. Réessayez." }, { status: 500 });
  }
}
