// Checkout mode: Tchentchen calls this once the shopper has paid, chosen cash on delivery, or used
// a method that confirms later, and again later for the same checkout (receipt page, Stripe's
// confirmation, the late success or failure). Every call: check the signature on the raw body,
// read the checkout's status from Tchentchen, then bring our order in step:
//   no order yet + paid / awaiting / cash_on_delivery  -> make it (one per checkout: its id is the cart_id)
//   order made on awaiting + now paid                  -> mark it paid
//   order made on awaiting + now failed                -> cancel it, put the stock back
//   anything else                                      -> change nothing
// and answer the same order every time. The order is priced by our database (place_order), with
// the promotion code and delivery the cart was priced with; a total that differs from what the
// shopper pays is written on the order for the merchant to look at before shipping.

import { NextResponse } from "next/server";
import postgres from "postgres";
import { UUID } from "@/lib/server/cart";
import { withDb } from "@/lib/server/db";
import {
  CHECKOUT_TOKEN,
  fromMinor,
  getCheckoutStatus,
  parseLineRef,
  refundCheckout,
  tctConfig,
  TchentchenError,
  toMinor,
  verifyEvent,
  type CheckoutStatus,
  type TctConfig,
} from "@/lib/server/tchentchen";
import { phoneDigits } from "@/lib/phone";

type Call = { type?: unknown; token?: unknown; cart_id?: unknown; livemode?: unknown };
type Answer = { status: number; body: Record<string, unknown> };

const answer = (status: number, body: Record<string, unknown>): Answer => ({ status, body });

export async function POST(req: Request) {
  const cfg = await tctConfig();
  if (!cfg) return NextResponse.json({ error: "tct_not_configured" }, { status: 503 });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (!(await verifyEvent(req.headers, raw, cfg.key))) return NextResponse.json({ error: "bad_signature" }, { status: 401 });

  let call: Call;
  try {
    call = JSON.parse(new TextDecoder().decode(raw)) as Call;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const token = typeof call.token === "string" ? call.token : "";
  const cartId = typeof call.cart_id === "string" ? call.cart_id : "";
  if (call.type !== "order" || !CHECKOUT_TOKEN.test(token) || !UUID.test(cartId)) return NextResponse.json({ error: "bad_call" }, { status: 400 });
  // A test checkout never makes a real order.
  if (cfg.mode === "live" && call.livemode !== true) return NextResponse.json({ error: "test_checkout" }, { status: 400 });

  try {
    const status = await getCheckoutStatus(cfg, token);
    if (status.cart_id !== cartId) return NextResponse.json({ error: "cart_mismatch" }, { status: 400 });
    const result = await withDb((sql) => sql.begin((tx) => bringInStep(tx, cfg, token, cartId, status)));
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("Tchentchen order hook failed", err instanceof TchentchenError || err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "internal" }, { status: 500 }); // Tchentchen calls again later
  }
}

type Tx = postgres.TransactionSql;

async function bringInStep(tx: Tx, cfg: TctConfig, token: string, orderId: string, s: CheckoutStatus): Promise<Answer> {
  const site = cfg.site;
  // Two calls for the same checkout at once: the second one waits for Tchentchen's next try.
  const [{ locked }] = await tx<{ locked: boolean }[]>`select pg_try_advisory_xact_lock(hashtext(${`tct-checkout:${token}`})) as locked`;
  if (!locked) return answer(503, { error: "order_in_progress" });

  const [co] = await tx<{ store_id: string; token: string | null; promo: string | null; shipping: string | null }[]>`
    select store_id, token, promo, shipping from public.tchentchen_checkouts where order_id = ${orderId}::uuid`;
  if (!co) return answer(404, { error: "unknown_cart" });
  if (co.token && co.token !== token) return answer(400, { error: "token_mismatch" });
  if (!co.token) await tx`update public.tchentchen_checkouts set token = ${token} where order_id = ${orderId}::uuid`;
  const [store] = await tx<{ slug: string }[]>`select slug from public.stores where id = ${co.store_id}::uuid`;
  const confirmation = `${site}/${encodeURIComponent(store.slug)}/merci/${orderId}`;

  const [order] = await tx<{ number: number; payment_method: string; payment_status: string; status: string; promo_code: string | null }[]>`
    select number, payment_method, payment_status, status, promo_code from public.orders where id = ${orderId}::uuid for update`;
  const ok = (number: number) => answer(200, { ok: true, order_id: orderId, reference: String(number), confirmation_url: confirmation });

  if (order) {
    const unpaidCard = order.payment_method === "card" && order.payment_status === "unpaid";
    const waiting = unpaidCard && order.status !== "cancelled";
    if (waiting && s.payment_state === "paid") await markPaid(tx, co.store_id, orderId, token, s);
    if (waiting && s.payment_state === "failed") {
      await tx`
        update public.products p set stock = p.stock + q.n
        from (select product_id, sum(quantity)::int as n from public.order_items where order_id = ${orderId}::uuid and product_id is not null group by 1) q
        where p.id = q.product_id and p.stock is not null`;
      if (order.promo_code) {
        await tx`update public.promo_codes set uses = greatest(uses - 1, 0) where store_id = ${co.store_id}::uuid and code = ${order.promo_code}`;
      }
      await tx`update public.orders set status = 'cancelled' where id = ${orderId}::uuid`;
    }
    // The seller canceled the order while the payment was still being confirmed, and it went
    // through afterwards: the money goes back to the shopper (same key as a cancel, never twice).
    if (unpaidCard && order.status === "cancelled" && s.payment_state === "paid") {
      await refundCheckout(cfg, token, s.amount_total, s.currency, `cancel.${orderId}`);
      await markPaid(tx, co.store_id, orderId, token, s);
      await tx`update public.payments set refunded = amount where reference = ${token} and provider = 'tchentchen'`;
      await tx`update public.orders set payment_status = 'refunded' where id = ${orderId}::uuid`;
    }
    return ok(order.number);
  }
  if (s.payment_state !== "paid" && s.payment_state !== "awaiting" && s.payment_state !== "cash_on_delivery") return answer(409, { error: "not_paid" });

  // The order from what the shopper chose and pays (the status), never from the cart we sent.
  const parsed = s.lines.map((l) => parseLineRef(l.ref, l.quantity));
  if (!parsed.length || parsed.some((i) => !i)) {
    console.error(`Tchentchen checkout ${orderId}: lines cannot be read`, JSON.stringify(s.lines).slice(0, 300));
    return answer(422, { error: "bad_lines" });
  }
  const items = parsed as NonNullable<(typeof parsed)[number]>[];
  const addr = s.shipping?.address;
  const name = (s.shipping?.name || s.customer?.name || "Client").trim().slice(0, 80);
  const phone = phoneDigits(s.customer?.phone ?? "") || (s.customer?.email ? `e-mail ${s.customer.email}` : `tchentchen ${token.slice(-10)}`);
  const city = (addr?.city ?? "").trim().slice(0, 60);
  const address = [addr?.line1, addr?.line2, addr?.postal_code].filter((v) => v && v.trim()).join(", ").slice(0, 300);
  const payment = s.payment_state === "cash_on_delivery" ? "cod" : "card";
  const shipping = s.selected_delivery_ref && UUID.test(s.selected_delivery_ref) ? s.selected_delivery_ref : co.shipping;
  const email = s.customer?.email ? `E-mail : ${s.customer.email}` : null;

  const place = (q: Tx, promo: string | null) => q<{ order_id: string; number: number; total: string }[]>`
    select * from public.place_order(${store.slug}, ${q.json(items)}, ${name}, ${phone}, ${city}, ${address}, ${payment},
      ${email}, ${shipping}, ${promo}, ${orderId}::uuid)`;
  const pgCode = (err: unknown) => (err instanceof postgres.PostgresError ? err.code : null);
  // The shopper has paid (or ordered cash on delivery) and saw Tchentchen's receipt: the order is
  // always made (owner's rule, 2026-11-05). When place_order refuses it, it is written as bought.
  const anyway = (err: unknown) => {
    if (pgCode(err) !== "P0400" && pgCode(err) !== "P0404") throw err;
    return takeAnyway(tx, { storeId: co.store_id, orderId, s, items, name, phone, city, address, payment, email, shipping, promo: co.promo }, (err as Error).message);
  };
  let placed: { order_id: string; number: number; total: string };
  try {
    [placed] = await tx.savepoint((sp) => place(sp, co.promo));
  } catch (err) {
    if (pgCode(err) !== "P0409" || !co.promo) placed = await anyway(err);
    else {
      // The code ran out since the cart was priced: the order is made without it.
      try {
        [placed] = await tx.savepoint((sp) => place(sp, null));
      } catch (err2) {
        placed = await anyway(err2);
      }
    }
  }

  // What the shopper pays against what our database computes now: a difference is held for the merchant.
  if (toMinor(placed.total) !== s.amount_total) {
    const warn = `À vérifier avant l'envoi : le client paie ${fromMinor(s.amount_total)} ${s.currency.toUpperCase()}, la boutique calcule ${placed.total}.`;
    await tx`update public.orders set note = concat_ws(' · ', note, ${warn}::text) where id = ${orderId}::uuid`;
  }
  if (s.payment_state === "paid") await markPaid(tx, co.store_id, orderId, token, s);
  return ok(placed.number);
}

// place_order refused an order the shopper already paid for (or confirmed cash on delivery): an
// item sold out or was taken off sale meanwhile, a payment or delivery method was turned off, or
// the store was unpublished. The order is written as bought, at Tchentchen's prices and total,
// without those checks, and its note tells the seller what to look at (ship, restock or refund
// with "Annuler et rembourser").
type Taken = {
  storeId: string;
  orderId: string;
  s: CheckoutStatus;
  items: { product_id: string; quantity: number; color_id: string | null; size: string | null }[];
  name: string;
  phone: string;
  city: string;
  address: string;
  payment: "card" | "cod";
  email: string | null;
  shipping: string | null;
  promo: string | null;
};
const REASONS: Record<string, string> = {
  bad_items: "un article n'est plus disponible (stock épuisé ou retiré de la vente)",
  payment_off: "ce moyen de paiement est désactivé dans la boutique",
  bad_shipping: "le mode de livraison choisi a changé",
  bad_payment: "moyen de paiement inconnu",
  store_not_found: "la boutique n'est plus publiée",
};

async function takeAnyway(tx: Tx, t: Taken, reason: string) {
  const { s, storeId, orderId } = t;
  const lines = s.lines.map((l, i) => ({ ...t.items[i], unit_price: fromMinor(l.unit_amount) }));
  const sub = s.lines.reduce((n, l) => n + l.unit_amount * l.quantity, 0);
  let discount = (s.cart_rules?.expected ?? []).reduce((n, d) => n + (d.amount > 0 ? d.amount : 0), 0);
  let fee = s.amount_total - sub + discount;
  if (fee < 0) [discount, fee] = [discount - fee, 0];
  const paid = t.payment === "cod" ? "à payer à la livraison" : s.payment_state === "paid" ? "payée par carte" : "paiement par carte en cours de confirmation";
  const note = [
    t.email,
    `À vérifier : commande ${paid}, prise malgré ce refus de la boutique : ${REASONS[reason] ?? reason}. Envoyez-la, réapprovisionnez, ou annulez et remboursez.`,
  ].filter(Boolean).join(" · ");

  const [{ id: customer }] = await tx<{ id: string }[]>`
    insert into public.customers (store_id, name, phone, city, address)
    values (${storeId}::uuid, ${t.name}, ${t.phone}, ${t.city}, ${t.address})
    on conflict (store_id, phone) do update set name = excluded.name, city = excluded.city, address = excluded.address
    returning id`;
  const [{ number, currency }] = await tx<{ number: number; currency: string }[]>`
    update public.stores set order_seq = order_seq + 1 where id = ${storeId}::uuid returning order_seq as number, currency`;
  const method = t.shipping
    ? (await tx<{ id: string; name: string }[]>`select id, name from public.shipping_methods where id = ${t.shipping}::uuid and store_id = ${storeId}::uuid`)[0]
    : undefined;
  await tx`
    insert into public.orders (id, store_id, number, customer_id, channel, payment_method, currency, subtotal, shipping_fee,
      discount, promo_code, total, shipping_method_id, shipping_name, customer_name, customer_phone, city, address, note)
    values (${orderId}::uuid, ${storeId}::uuid, ${number}, ${customer}::uuid, 'online', ${t.payment}, ${currency}, ${fromMinor(sub)},
      ${fromMinor(fee)}, ${fromMinor(discount)}, ${discount > 0 ? t.promo : null}, ${fromMinor(s.amount_total)}, ${method?.id ?? null},
      ${method?.name ?? (fee > 0 ? "Livraison" : null)}, ${t.name}, ${t.phone}, ${t.city}, ${t.address}, ${note})`;
  await tx`
    insert into public.order_items (order_id, store_id, product_id, name, unit_price, quantity, color, size)
    select ${orderId}::uuid, ${storeId}::uuid, p.id, coalesce(p.name, 'Article retiré de la boutique'), i.unit_price, i.quantity, c.name, i.size
    from jsonb_to_recordset(${tx.json(lines)}) as i(product_id uuid, color_id uuid, size text, quantity int, unit_price numeric)
    left join public.products p on p.id = i.product_id and p.store_id = ${storeId}::uuid
    left join public.product_colors c on c.id = i.color_id and c.product_id = p.id`;
  await tx`
    update public.products p set stock = greatest(p.stock - q.n, 0)
    from (select product_id, sum(quantity)::int as n from public.order_items where order_id = ${orderId}::uuid and product_id is not null group by 1) q
    where p.id = q.product_id and p.stock is not null`;
  if (discount > 0 && t.promo) {
    await tx`update public.promo_codes set uses = uses + 1 where store_id = ${storeId}::uuid and code = ${t.promo}`;
  }
  console.error(`Tchentchen checkout ${orderId}: order taken anyway (${reason})`);
  return { order_id: orderId, number, total: fromMinor(s.amount_total).toFixed(2) };
}

// The money is on the platform's Stripe account: one payment row per checkout (its token).
async function markPaid(tx: Tx, storeId: string, orderId: string, token: string, s: CheckoutStatus) {
  await tx`
    insert into public.payments (store_id, order_id, method, provider, amount, reference)
    values (${storeId}::uuid, ${orderId}::uuid, 'card', 'tchentchen', ${fromMinor(s.amount_total)}, ${token})
    on conflict (reference) where provider = 'tchentchen' do nothing`;
  await tx`update public.orders set payment_status = 'paid' where id = ${orderId}::uuid and payment_status in ('unpaid', 'partial')`;
}
