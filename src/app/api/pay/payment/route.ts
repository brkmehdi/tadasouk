// The card payment of a checkout, created when the buyer picks Card and again each time the total
// changes (a new payment, the old one canceled: an amount is never changed). The order does not
// exist yet: its id is chosen here and becomes the payment's reference, and its number is the
// store's next one; /api/orders checks the payment before it places the order under that id.
// Only the client token (and the pay page link, the fallback) goes back to the page.

import { NextResponse } from "next/server";
import { cleanItems, UUID } from "@/lib/server/cart";
import { withDb } from "@/lib/server/db";
import {
  cancelPayment,
  createPayment,
  getPayment,
  orderDescription,
  PAYMENT_ID,
  payErrorResponse,
  payLocale,
  requireTct,
  sellerMetadata,
  TchentchenError,
  toMinor,
  type PaymentLine,
} from "@/lib/server/tchentchen";

type Body = {
  slug?: string;
  items?: unknown;
  shipping?: string | null;
  promo?: string | null;
  order?: string;
  replace?: string;
  attempt?: string;
  name?: string;
  phone?: string;
  locale?: string;
};
type Store = { id: string; name: string; city: string | null; currency: string; order_seq: number; card_enabled: boolean };
type Cart = {
  lines: { name: string; unit_price: number | null; quantity: number; image: string | null; ok: boolean }[];
  discount: number;
  promo_code: string | null;
  promo_error: string | null;
  shipping: { id: string; name: string; fee: number } | null;
  total: number;
};

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const items = cleanItems(b.items);
  const promo = typeof b.promo === "string" && b.promo.trim() ? b.promo.trim().slice(0, 30) : null;
  if (
    typeof b.slug !== "string" ||
    !items?.length ||
    (b.shipping != null && !UUID.test(b.shipping)) ||
    (b.order != null && !UUID.test(b.order)) ||
    (b.replace != null && !PAYMENT_ID.test(b.replace)) ||
    (b.attempt != null && !UUID.test(b.attempt))
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  try {
    const cfg = await requireTct();
    const orderId = b.order ?? crypto.randomUUID();
    const found = await withDb(async (sql) => {
      const [store] = await sql<Store[]>`
        select id, name, city, currency, order_seq, card_enabled from public.stores where slug = ${b.slug!} and published`;
      if (!store) return null;
      const [taken] = await sql`select 1 from public.orders where id = ${orderId}::uuid`;
      const [{ c: cart }] = await sql<{ c: Cart }[]>`select public.cart_total(${store.id}::uuid, ${sql.json(items)}, ${b.shipping ?? null}, ${promo}) as c`;
      return { store, cart, taken: !!taken };
    });
    if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const { store, cart, taken } = found;
    if (!store.card_enabled) return NextResponse.json({ error: "not_payable" }, { status: 409 });
    if (taken) return NextResponse.json({ error: "order_exists" }, { status: 409 });
    if (cart.lines.some((l) => !l.ok) || (promo && cart.promo_error)) return NextResponse.json({ error: "bad_cart" }, { status: 400 });

    // The lines go along when they add up to the total: goods, the promotion (negative), delivery.
    const amount = toMinor(cart.total);
    const lines: PaymentLine[] = cart.lines.map((l) => ({
      name: l.name.slice(0, 120),
      quantity: l.quantity,
      unit_amount: toMinor(l.unit_price ?? 0),
      ...(l.image ? { image_url: `${cfg.site}/media/${l.image}` } : {}),
    }));
    if (cart.discount > 0) lines.push({ name: cart.promo_code ? `Code ${cart.promo_code}` : "Remise", quantity: 1, unit_amount: -toMinor(cart.discount) });
    if (cart.shipping && cart.shipping.fee > 0) lines.push({ name: cart.shipping.name.slice(0, 120), quantity: 1, unit_amount: toMinor(cart.shipping.fee) });
    const sum = lines.reduce((n, l) => n + l.unit_amount * l.quantity, 0);

    const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
    const phone = typeof b.phone === "string" && /^\d{9,15}$/.test(b.phone) ? `+${b.phone}` : "";
    const customer = name.length >= 2 || phone ? { ...(name.length >= 2 ? { name } : {}), ...(phone ? { phone } : {}) } : undefined;

    const payment = await createPayment(
      cfg,
      {
        amount,
        currency: store.currency.toLowerCase(),
        reference: orderId,
        site_url: cfg.site,
        description: orderDescription(store.name, store.order_seq + 1),
        lines: sum === amount ? lines : undefined,
        customer,
        metadata: sellerMetadata(store),
        return_url: `${cfg.site}/${encodeURIComponent(b.slug)}/merci/${orderId}`,
        events_url: `${cfg.site}/api/pay/webhook`,
        locale: payLocale(b.locale),
      },
      `${orderId}.${b.attempt ?? crypto.randomUUID()}`,
    );

    // The previous payment of this checkout can no longer be paid (only one of this order's).
    if (b.replace && b.replace !== payment.id) {
      try {
        const old = await getPayment(cfg, b.replace);
        if (old.reference === orderId && old.status === "open") await cancelPayment(cfg, old.id);
      } catch (err) {
        console.warn("Tchentchen: the previous payment was not canceled", err instanceof Error ? err.message : "");
      }
    }

    return NextResponse.json({ order: orderId, payment: payment.id, client_token: payment.client_token, url: payment.url, amount: payment.amount });
  } catch (err) {
    if (err instanceof TchentchenError && err.code === "amount_too_small") {
      return NextResponse.json({ error: "amount_too_small", message: "Ce montant est trop petit pour un paiement par carte." }, { status: 400 });
    }
    return payErrorResponse(err);
  }
}
