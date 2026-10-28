// An order from a public store. The basket only names products and quantities: the database
// prices them from the published products (place_order in supabase/migrations), numbers the order
// for the store, and keeps the customer for the merchant's next contact.

import { NextResponse } from "next/server";
import postgres from "postgres";
import { withDb } from "@/lib/server/db";

type Body = {
  slug?: string;
  items?: { product_id?: string; quantity?: number }[];
  name?: string;
  phone?: string;
  city?: string;
  address?: string;
  payment?: string;
  note?: string;
};

const text = (v: unknown, min: number, max: number) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const items = Array.isArray(b.items) ? b.items : [];
  if (
    !text(b.slug, 3, 40) ||
    !items.length ||
    items.length > 50 ||
    !items.every((i) => typeof i.product_id === "string" && Number.isInteger(i.quantity)) ||
    !text(b.name, 2, 80) ||
    !/^\d{9,15}$/.test(b.phone ?? "") ||
    !text(b.city, 2, 60) ||
    !text(b.address, 3, 300) ||
    (b.note != null && typeof b.note !== "string")
  ) {
    return NextResponse.json({ error: "bad_request", message: "Vérifiez le nom, le téléphone, la ville et l'adresse." }, { status: 400 });
  }
  try {
    const row = await withDb(async (sql) => {
      const [r] = await sql<{ number: number; total: string }[]>`select * from public.place_order(
        ${b.slug!}, ${sql.json(items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })))},
        ${b.name!.trim()}, ${b.phone!}, ${b.city!.trim()}, ${b.address!.trim()}, ${b.payment ?? "cod"}, ${(b.note ?? "").trim().slice(0, 300) || null})`;
      return r;
    });
    return NextResponse.json({ number: row.number, total: Number(row.total) });
  } catch (err) {
    if (err instanceof postgres.PostgresError && err.code === "P0404") {
      return NextResponse.json({ error: "not_found", message: "Cette boutique n'est pas en ligne." }, { status: 404 });
    }
    if (err instanceof postgres.PostgresError && err.code === "P0400") {
      return NextResponse.json(
        { error: "bad_order", message: "Un produit du panier n'est plus disponible. Rechargez la page et réessayez." },
        { status: 400 },
      );
    }
    console.error("order failed", err);
    return NextResponse.json({ error: "internal", message: "La commande n'est pas passée. Réessayez." }, { status: 500 });
  }
}
