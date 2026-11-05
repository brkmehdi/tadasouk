// The merchant cancels a card order. Every Tchentchen payment of the order is read first: a paid
// one is refunded (POST /payments/{id}/refunds, what is left of it, with an idempotency key so a
// retry never refunds twice), an open one is canceled so it can no longer be paid. The order is
// marked cancelled only once that worked; an unpaid order without Tchentchen set up is simply
// cancelled.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import {
  cancelPayment,
  payErrorResponse,
  recordPaid,
  recordRefunds,
  refundCheckout,
  refundPayment,
  settleOrder,
  tctConfig,
  TchentchenNotConfiguredError,
  toMinor,
} from "@/lib/server/tchentchen";

type Order = { id: string; store_id: string; payment_method: string; payment_status: string; status: string };

class PaymentProcessing extends Error {}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { orderId } = (await req.json().catch(() => ({}))) as { orderId?: string };
    if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const refunded = await withDb(async (sql) => {
      const [o] = await sql<Order[]>`
        select o.id, o.store_id, o.payment_method, o.payment_status, o.status
        from public.orders o join public.stores s on s.id = o.store_id
        where o.id = ${orderId}::uuid and s.owner_id = ${user.id}::uuid`;
      if (!o) return null;
      if (o.status === "delivered" || o.status === "cancelled") return 0;

      let total = 0;
      if (o.payment_method === "card") {
        const cfg = await tctConfig();
        if (!cfg) {
          if (o.payment_status !== "unpaid") throw new TchentchenNotConfiguredError();
        } else {
          const payments = await settleOrder(sql, cfg, o.id);
          // A payment still being confirmed can be neither refunded nor canceled yet.
          if (payments.some((p) => p.status === "processing" && p.reference === o.id)) throw new PaymentProcessing();
          for (const p of payments) {
            if (p.reference !== o.id || p.metadata?.seller_id !== o.store_id) continue;
            if (p.status === "open") await cancelPayment(cfg, p.id);
            if (p.status === "paid" && p.amount_refunded < p.amount) {
              const r = await refundPayment(cfg, p.id, `cancel-order.${o.id}.${p.id}`);
              await recordPaid(sql, cfg, r.payment);
              await recordRefunds(sql, r.payment);
              total += r.refund.amount;
            }
          }
          // Checkout mode: the order was paid in Tchentchen's checkout, recorded under its token.
          const checkouts = await sql<{ id: string; reference: string; amount: string; refunded: string }[]>`
            select id, reference, amount, refunded from public.payments
            where order_id = ${o.id}::uuid and provider = 'tchentchen' and reference like 'tct\\_%' and refunded < amount`;
          const [{ currency }] = await sql<{ currency: string }[]>`select currency from public.orders where id = ${o.id}::uuid`;
          for (const c of checkouts) {
            const left = toMinor(c.amount) - toMinor(c.refunded);
            // One checkout per order (its id is the cart_id): the key stays within the 80 characters allowed.
            await refundCheckout(cfg, c.reference, left, currency.toLowerCase(), `cancel.${o.id}`);
            await sql`update public.payments set refunded = amount where id = ${c.id}::uuid`;
            await sql`update public.orders set payment_status = 'refunded' where id = ${o.id}::uuid`;
            total += left;
          }
        }
      }
      await sql`update public.orders set status = 'cancelled' where id = ${o.id}::uuid`;
      return total;
    });
    if (refunded === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, refunded_minor: refunded });
  } catch (err) {
    if (err instanceof PaymentProcessing) {
      return NextResponse.json({ error: "payment_processing", message: "Un paiement est en cours de confirmation. Réessayez dans quelques minutes." }, { status: 409 });
    }
    return payErrorResponse(err);
  }
}
