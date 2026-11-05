// "Payer par carte" on the thank-you page of a card order still unpaid (the card was refused, the
// buyer left before paying, or the card form could not load): sends the buyer to Tchentchen's pay
// page. Every payment of the order is read first: a paid one is recorded and nothing new is made;
// an open one for the right amount is reused; otherwise the open ones are canceled and a new one
// is made. The order id is the key, as on the thank-you page (a UUID nobody can guess).

import { NextResponse } from "next/server";
import { withDb } from "@/lib/server/db";
import {
  cancelPayment,
  createPayment,
  orderDescription,
  payErrorResponse,
  requireTct,
  sellerMetadata,
  settleOrder,
  toMinor,
  type PaymentLine,
} from "@/lib/server/tchentchen";

type Body = { slug?: string; order?: string };
type Row = {
  id: string;
  number: number;
  total: string;
  discount: string;
  promo_code: string | null;
  shipping_fee: string;
  shipping_name: string | null;
  currency: string;
  payment_method: string;
  payment_status: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  store_id: string;
  store_name: string;
  store_city: string | null;
  card_enabled: boolean;
  items: { name: string; quantity: number; unit_price: string }[];
};

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  if (typeof b.slug !== "string" || !/^[0-9a-f-]{36}$/i.test(b.order ?? "")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  try {
    const cfg = await requireTct();
    const result = await withDb(async (sql) => {
      const read = async () => {
        const [o] = await sql<Row[]>`
          select o.id, o.number, o.total, o.discount, o.promo_code, o.shipping_fee, o.shipping_name, o.currency,
                 o.payment_method, o.payment_status, o.status, o.customer_name, o.customer_phone,
                 s.id as store_id, s.name as store_name, s.city as store_city, s.card_enabled,
                 (select coalesce(json_agg(json_build_object('name', i.name, 'quantity', i.quantity, 'unit_price', i.unit_price)), '[]')
                    from public.order_items i where i.order_id = o.id) as items
          from public.orders o join public.stores s on s.id = o.store_id
          where o.id = ${b.order!}::uuid and s.slug = ${b.slug!}`;
        return o;
      };
      let o = await read();
      if (!o) return { status: 404, body: { error: "not_found" } };
      if (o.payment_method !== "card" || o.status === "cancelled") return { status: 409, body: { error: "not_payable" } };
      if (o.payment_status !== "unpaid") return { status: 200, body: { paid: true } };

      const payments = await settleOrder(sql, cfg, o.id);
      o = (await read())!;
      if (o.payment_status !== "unpaid") return { status: 200, body: { paid: true } };
      if (payments.some((p) => p.status === "processing")) return { status: 200, body: { processing: true } };

      const amount = toMinor(o.total);
      const description = orderDescription(o.store_name, o.number);
      const open = payments.filter((p) => p.status === "open" && p.reference === o!.id);
      const reuse = open.find(
        (p) => p.amount === amount && p.description === description && p.metadata?.seller_id === o!.store_id && p.expires_at > Date.now() / 1000 + 600,
      );
      if (reuse) return { status: 200, body: { url: reuse.url } };
      for (const p of open) await cancelPayment(cfg, p.id).catch(() => null);

      const lines: PaymentLine[] = o.items.map((i) => ({ name: i.name.slice(0, 120), quantity: i.quantity, unit_amount: toMinor(i.unit_price) }));
      if (Number(o.discount) > 0) lines.push({ name: o.promo_code ? `Code ${o.promo_code}` : "Remise", quantity: 1, unit_amount: -toMinor(o.discount) });
      if (Number(o.shipping_fee) > 0) lines.push({ name: (o.shipping_name ?? "Livraison").slice(0, 120), quantity: 1, unit_amount: toMinor(o.shipping_fee) });
      const sum = lines.reduce((n, l) => n + l.unit_amount * l.quantity, 0);
      const back = `${cfg.site}/${encodeURIComponent(b.slug!)}/merci/${o.id}`;
      const p = await createPayment(
        cfg,
        {
          amount,
          currency: o.currency.toLowerCase(),
          reference: o.id,
          site_url: cfg.site,
          description,
          lines: sum === amount ? lines : undefined,
          customer: o.customer_name && o.customer_phone ? { name: o.customer_name, phone: `+${o.customer_phone}` } : undefined,
          metadata: sellerMetadata({ id: o.store_id, name: o.store_name, city: o.store_city }),
          return_url: back,
          events_url: `${cfg.site}/api/pay/webhook`,
          locale: "fr",
        },
        `${o.id}.later.${crypto.randomUUID()}`,
      );
      return { status: 200, body: { url: p.url } };
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return payErrorResponse(err);
  }
}
