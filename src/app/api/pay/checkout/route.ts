// Checkout mode: the cart becomes a Tchentchen checkout (POST /checkout/session), opened in a frame
// on /paiement. Our database prices the cart (cart_total, with the delivery method and the
// promotion code), and the order id is chosen here: it is Tchentchen's cart_id, and the order
// hook (/api/pay/order-hook) makes the order under it once the shopper has paid or chosen cash
// on delivery. A checkout whose total Tchentchen computes differently is not opened.

import { NextResponse } from "next/server";
import { cleanItems, UUID } from "@/lib/server/cart";
import { withDb } from "@/lib/server/db";
import { delayText } from "@/lib/shop";
import { checkoutModeOn, createCheckout, lineRef, payErrorResponse, requireTct, toMinor, type CheckoutSessionInput } from "@/lib/server/tchentchen";

type Body = { slug?: string; items?: unknown; shipping?: string | null; promo?: string | null };
type Store = { id: string; name: string; currency: string; card_enabled: boolean; cod_enabled: boolean };
type Cart = {
  lines: { product_id: string; color_id: string | null; color: string | null; size: string | null; name: string; unit_price: number | null; quantity: number; image: string | null; ok: boolean }[];
  discount: number;
  promo_code: string | null;
  promo_error: string | null;
  shipping: { id: string; name: string; fee: number } | null;
  shipping_options: { id: string; name: string; fee: number; delay_days: number | null }[];
  total: number;
};

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const items = cleanItems(b.items);
  const promo = typeof b.promo === "string" && b.promo.trim() ? b.promo.trim().slice(0, 30) : null;
  if (typeof b.slug !== "string" || !items?.length || (b.shipping != null && !UUID.test(b.shipping))) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!checkoutModeOn()) return NextResponse.json({ error: "checkout_mode_off" }, { status: 409 });
  try {
    const cfg = await requireTct();
    const found = await withDb(async (sql) => {
      const [store] = await sql<Store[]>`
        select id, name, currency, card_enabled, cod_enabled from public.stores where slug = ${b.slug!} and published`;
      if (!store) return null;
      const [{ c: cart }] = await sql<{ c: Cart }[]>`select public.cart_total(${store.id}::uuid, ${sql.json(items)}, ${b.shipping ?? null}, ${promo}) as c`;
      return { store, cart };
    });
    if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const { store, cart } = found;
    if (!store.card_enabled) return NextResponse.json({ error: "not_payable" }, { status: 409 });
    if (cart.lines.some((l) => !l.ok) || (promo && cart.promo_error)) return NextResponse.json({ error: "bad_cart" }, { status: 400 });

    const orderId = crypto.randomUUID();
    const total = toMinor(cart.total);
    // Delivery: the store's methods, the chosen one selected. A store without any: one free
    // option, the seller confirms the delivery on WhatsApp as in our own checkout.
    const options = cart.shipping_options.length
      ? cart.shipping_options.map((s, i) => ({
          carrier_id: i + 1,
          ref: s.id,
          label: s.name.slice(0, 120),
          ...(delayText(s.delay_days) ? { delay: delayText(s.delay_days)! } : {}),
          amount: toMinor(s.fee),
        }))
      : [{ carrier_id: 1, ref: "none", label: "Livraison à confirmer avec le vendeur", amount: 0 }];
    const selected = Math.max(1, cart.shipping_options.findIndex((s) => s.id === cart.shipping?.id) + 1);

    const site = cfg.site;
    const slug = encodeURIComponent(b.slug);
    const input: CheckoutSessionInput = {
      cart: {
        cart_id: orderId,
        currency: store.currency.toLowerCase(),
        prices_include_tax: true,
        line_items: cart.lines.map((l, i) => ({
          platform_product_id: i + 1,
          ref: lineRef(l),
          name: [l.name, l.color, l.size && `taille ${l.size}`].filter(Boolean).join(", ").slice(0, 120),
          quantity: l.quantity,
          unit_amount: toMinor(l.unit_price ?? 0),
          ...(l.image ? { image_url: `${site}/media/${l.image}` } : {}),
        })),
        shipping: { selected_carrier_id: selected, options },
        taxes: [],
        discounts:
          cart.discount > 0
            ? [{ label: cart.promo_code ? `Code ${cart.promo_code}` : "Remise", amount: toMinor(cart.discount), free_shipping: false }]
            : [],
        customer: { country: "MA" },
        totals_check: { order_total: total },
      },
      catalog: { ui: { merchant_name: store.name.slice(0, 80), cash_on_delivery: store.cod_enabled, terms_checkbox: false } },
      shop: {
        platform: "custom",
        base_url: `${site}/`,
        success_url: `${site}/${slug}/merci/${orderId}`,
        cancel_url: `${site}/${slug}/panier`,
        frame_url: `${site}/${slug}/paiement`,
        locale: "fr",
        hooks: { order: `${site}/api/pay/order-hook` },
      },
    };

    // Kept before the session exists, so the order hook always finds the store and the code.
    await withDb(
      (sql) => sql`
        insert into public.tchentchen_checkouts (order_id, store_id, promo, shipping, amount)
        values (${orderId}::uuid, ${store.id}::uuid, ${cart.promo_code}, ${cart.shipping?.id ?? null}, ${cart.total})`,
    );
    const session = await createCheckout(cfg, input);
    if (!session.totals_match) {
      console.error(`Tchentchen checkout ${orderId}: totals differ (ours ${total}, Tchentchen ${session.amount_total})`);
      return NextResponse.json({ error: "totals_mismatch", message: "Le total ne correspond pas. Rechargez la page." }, { status: 409 });
    }
    await withDb((sql) => sql`update public.tchentchen_checkouts set token = ${session.token} where order_id = ${orderId}::uuid`);
    return NextResponse.json({ checkout_url: session.checkout_url, order: orderId });
  } catch (err) {
    return payErrorResponse(err);
  }
}
