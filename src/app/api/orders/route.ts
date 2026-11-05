// An order from a public store. The cart only names products, colours, sizes and quantities: the
// database prices them (place_order, with the delivery method and the promotion code), numbers
// the order for the store, and keeps the customer for the merchant's next contact.
//
// A card order comes with the Tchentchen payment made for it (/api/pay/payment): the order is
// placed under that payment's reference, and only if the payment, read from Tchentchen, is still
// open, for this store, for exactly the order's total and number. Otherwise nothing is kept
// (payment_stale): the page makes a new payment and tries again. The card is charged after.

import { NextResponse } from "next/server";
import postgres from "postgres";
import { cleanItems, UUID } from "@/lib/server/cart";
import { withDb } from "@/lib/server/db";
import { getPayment, orderDescription, PAYMENT_ID, payErrorResponse, requireTct, toMinor, type Payment } from "@/lib/server/tchentchen";

class StalePayment extends Error {}

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
  order_id?: string; // card: the order id the payment was made for
  payment_id?: string; // card: that Tchentchen payment
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
  const card = b.payment === "card";
  if (card && (!UUID.test(b.order_id ?? "") || !PAYMENT_ID.test(b.payment_id ?? ""))) {
    return NextResponse.json({ error: "payment_stale", message: "Le paiement par carte n'est pas prêt. Réessayez." }, { status: 409 });
  }
  try {
    let payment: Payment | null = null;
    if (card) {
      payment = await getPayment(await requireTct(), b.payment_id!);
      if (payment.reference !== b.order_id || payment.status !== "open") throw new StalePayment();
    }
    const row = await withDb((sql) =>
      sql.begin(async (tx) => {
        type Placed = { order_id: string; number: number; total: string; store_id: string };
        const [r] = card
          ? await tx<Placed[]>`select * from public.place_order(
              ${b.slug!}, ${tx.json(items)},
              ${b.name!.trim()}, ${b.phone!}, ${b.city!.trim()}, ${b.address!.trim()}, 'card',
              ${(b.note ?? "").trim().slice(0, 300) || null}, ${b.shipping ?? null}, ${promo}, ${b.order_id!}::uuid)`
          : await tx<Placed[]>`select * from public.place_order(
              ${b.slug!}, ${tx.json(items)},
              ${b.name!.trim()}, ${b.phone!}, ${b.city!.trim()}, ${b.address!.trim()}, ${b.payment ?? "cod"},
              ${(b.note ?? "").trim().slice(0, 300) || null}, ${b.shipping ?? null}, ${promo})`;
        if (payment) {
          // Rolled back unless the payment is exactly this order's.
          const [s] = await tx<{ name: string; currency: string }[]>`select name, currency from public.stores where id = ${r.store_id}::uuid`;
          if (
            payment.metadata?.seller_id !== r.store_id ||
            payment.amount !== toMinor(r.total) ||
            payment.currency.toLowerCase() !== s.currency.toLowerCase() ||
            payment.description !== orderDescription(s.name, r.number)
          ) {
            throw new StalePayment();
          }
        }
        return r;
      }),
    );
    return NextResponse.json({ id: row.order_id, number: row.number, total: Number(row.total) });
  } catch (err) {
    if (err instanceof StalePayment) {
      return NextResponse.json({ error: "payment_stale", message: "Le total a changé. Réessayez." }, { status: 409 });
    }
    if (card && !(err instanceof postgres.PostgresError)) return payErrorResponse(err);
    const code = err instanceof postgres.PostgresError ? err.code : null;
    if (code === "23505") {
      return NextResponse.json({ error: "order_exists", message: "Cette commande est déjà enregistrée." }, { status: 409 });
    }
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
