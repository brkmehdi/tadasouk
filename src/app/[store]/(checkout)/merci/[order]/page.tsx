// After the order: its number, what was ordered, the totals, and a message to the seller on
// WhatsApp. The order id in the link is the only key (a UUID nobody can guess); the page shows
// the city, never the address or the phone.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPrice } from "@/lib/money";
import { withDb } from "@/lib/server/db";
import { loadStore } from "@/lib/storefront";
import { CircleCheck } from "../../../_ui/icons";

export const metadata: Metadata = { title: "Merci", robots: { index: false } };

type Params = { params: Promise<{ store: string; order: string }> };
type Row = {
  number: number;
  customer_name: string | null;
  city: string | null;
  subtotal: string;
  discount: string;
  shipping_fee: string;
  shipping_name: string | null;
  total: string;
  payment_method: string;
  items: { name: string; quantity: number; unit_price: string; color: string | null; size: string | null }[];
};

export default async function Merci({ params }: Params) {
  const { store: slug, order } = await params;
  const found = await loadStore(slug);
  if (!found || !/^[0-9a-f-]{36}$/i.test(order)) notFound();
  const { store } = found;
  const [o] = await withDb(
    (sql) => sql<Row[]>`
      select o.number, o.customer_name, o.city, o.subtotal, o.discount, o.shipping_fee, o.shipping_name, o.total, o.payment_method,
             (select coalesce(json_agg(json_build_object('name', i.name, 'quantity', i.quantity, 'unit_price', i.unit_price,
                       'color', i.color, 'size', i.size) order by i.name), '[]') from public.order_items i where i.order_id = o.id) as items
      from public.orders o where o.id = ${order}::uuid and o.store_id = ${store.id}::uuid`,
  );
  if (!o) notFound();
  const money = (v: string | number) => formatPrice(Number(v), store.currency);
  const message = `Bonjour, je viens de passer la commande n°${o.number} (${money(o.total)}) sur votre boutique ${store.name}.`;

  return (
    <main className="mx-auto max-w-[420px] px-4 pt-14 pb-20">
      <Link href={`/${store.slug}`} className="text-[16px] font-bold tracking-[-0.03em] text-[#1a1a1a]">
        {store.name}
        <span className="text-brand">.</span>
      </Link>
      <div className="shop-fade-up mt-10 flex flex-col items-center text-center">
        <CircleCheck size={44} className="text-ok" />
        <h1 className="mt-4 text-[24px] font-semibold tracking-[-0.02em]">Merci{o.customer_name ? ` ${o.customer_name.split(" ")[0]}` : ""} !</h1>
        <p className="mt-2 text-[15px] text-ink-2">
          Votre commande n°{o.number} est enregistrée. {store.name} vous contacte sur WhatsApp pour confirmer la livraison
          {o.city ? ` à ${o.city}` : ""}.
        </p>
      </div>

      <ul className="mt-10 flex flex-col gap-3 border-t border-black/10 pt-6">
        {o.items.map((i, n) => (
          <li key={n} className="flex justify-between gap-3 text-[14px]">
            <span>
              <span className="font-medium">{i.name}</span>
              <span className="block text-[12px] text-ink-3">
                {[i.color, i.size && `taille ${i.size}`, `qté ${i.quantity}`].filter(Boolean).join(", ")}
              </span>
            </span>
            <span className="font-medium tabular-nums">{money(Number(i.unit_price) * i.quantity)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-6 flex flex-col gap-2 border-t border-black/10 pt-4 text-[14px]">
        <div className="flex justify-between">
          <dt>Sous-total</dt>
          <dd className="tabular-nums">{money(o.subtotal)}</dd>
        </div>
        {Number(o.discount) > 0 && (
          <div className="flex justify-between">
            <dt>Remise</dt>
            <dd className="tabular-nums">-{money(o.discount)}</dd>
          </div>
        )}
        {o.shipping_name && (
          <div className="flex justify-between">
            <dt>Livraison ({o.shipping_name})</dt>
            <dd className="tabular-nums">{Number(o.shipping_fee) ? money(o.shipping_fee) : "Gratuite"}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-black/10 pt-3 text-[16px] font-semibold">
          <dt>{o.payment_method === "cod" ? "À payer à la livraison" : "Total"}</dt>
          <dd className="tabular-nums">{money(o.total)}</dd>
        </div>
      </dl>

      <div className="mt-8 flex flex-col gap-3">
        {store.whatsapp && (
          <a href={`https://wa.me/${store.whatsapp}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener" className="ui-btn ui-btn-primary h-12 text-[16px]">
            Écrire au vendeur sur WhatsApp
          </a>
        )}
        <Link href={`/${store.slug}`} className="ui-btn ui-btn-secondary h-12 text-[16px] text-ink">
          Continuer mes achats
        </Link>
      </div>
    </main>
  );
}
