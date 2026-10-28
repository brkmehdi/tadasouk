"use client";

// Sales: the orders of the online store (newest first) and the counter sale. An order moves
// along: confirmed, shipped, delivered and paid (cash on delivery records the payment), or
// cancelled. The customer is one tap away on WhatsApp.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CatalogProduct } from "@/lib/catalog/types";
import { useT } from "@/lib/i18n";
import { formatPrice } from "@/lib/money";
import { supabase } from "@/lib/supabase/browser";
import type { Order } from "@/lib/catalog/orders";
import type { Store } from "./BackOffice";

const STATUS = {
  pending: { fr: "Nouvelle", en: "New", tone: "bg-brand/10 text-brand" },
  confirmed: { fr: "Confirmée", en: "Confirmed", tone: "bg-amber-100 text-amber-800" },
  shipped: { fr: "Expédiée", en: "Shipped", tone: "bg-violet-100 text-violet-800" },
  delivered: { fr: "Livrée", en: "Delivered", tone: "bg-ok/15 text-ok" },
  cancelled: { fr: "Annulée", en: "Cancelled", tone: "bg-soft text-ink-3" },
} as const;

type Props = { store: Store; orders: Order[]; products: CatalogProduct[]; onCounterSale: () => void };

export default function SalesTab({ store, orders, products, onCounterSale }: Props) {
  const { t, lang } = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = orders.find((o) => o.id === openId) ?? null;

  return (
    <section className="mt-2">
      <h1 className="text-lg font-semibold tracking-[-0.01em]">{t("sales.title")}</h1>

      <button
        type="button"
        onClick={onCounterSale}
        disabled={products.length === 0}
        className="ui-card mt-3 flex w-full items-center gap-3 p-4 text-start disabled:opacity-50"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 6v12M8 6v12M11 6v12M15 6v12M18 6v12M20 6v12" />
          </svg>
        </span>
        <span>
          <span className="block text-sm font-medium">{t("sales.counter")}</span>
          <span className="block text-xs text-ink-3">{t("sales.counterHint")}</span>
        </span>
      </button>

      {orders.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">{t("sales.empty")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {orders.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setOpenId(o.id)} className="flex w-full items-center gap-3 py-3 text-start">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    n°{o.number} · {o.customer_name}
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {new Date(o.created_at).toLocaleString(lang === "fr" ? "fr-MA" : "en-GB", { dateStyle: "short", timeStyle: "short" })} ·{" "}
                    {o.city} · {o.order_items.reduce((n, i) => n + i.quantity, 0)} art.
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{formatPrice(o.total, o.currency)}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS[o.status].tone}`}>{STATUS[o.status][lang]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && <OrderSheet key={open.id} store={store} o={open} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function OrderSheet({ store, o, onClose }: { store: Store; o: Order; onClose: () => void }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const fr = lang === "fr";

  const move = async (status: Order["status"], paid = false) => {
    setBusy(true);
    const db = supabase();
    await db
      .from("orders")
      .update(paid ? { status, payment_status: "paid" } : { status })
      .eq("id", o.id);
    if (paid) await db.from("payments").insert({ store_id: store.id, order_id: o.id, method: "cash", provider: "cash", amount: o.total });
    setBusy(false);
    router.refresh();
  };

  const wa = o.customer_phone
    ? `https://wa.me/${o.customer_phone}?text=${encodeURIComponent(
        fr
          ? `Bonjour ${o.customer_name ?? ""}, c'est ${store.name}. Votre commande n°${o.number} (${formatPrice(o.total, o.currency)}) est bien reçue.`
          : `Hello ${o.customer_name ?? ""}, this is ${store.name}. Your order #${o.number} (${formatPrice(o.total, o.currency)}) is received.`,
      )}`
    : null;

  const next: { label: string; run: () => void; primary?: boolean }[] = [];
  if (o.status === "pending") next.push({ label: fr ? "Confirmer la commande" : "Confirm the order", run: () => void move("confirmed"), primary: true });
  if (o.status === "confirmed") next.push({ label: fr ? "Marquer expédiée" : "Mark as shipped", run: () => void move("shipped"), primary: true });
  if (o.status === "shipped" || o.status === "confirmed")
    next.push({
      label: o.payment_method === "cod" ? (fr ? "Livrée et payée" : "Delivered and paid") : fr ? "Livrée" : "Delivered",
      run: () => void move("delivered", o.payment_method === "cod"),
      primary: o.status === "shipped",
    });
  if (o.status !== "delivered" && o.status !== "cancelled") next.push({ label: fr ? "Annuler" : "Cancel", run: () => void move("cancelled") });

  return (
    <div className="fixed inset-0 z-40">
      <div className="ui-scrim" onClick={onClose} />
      <div className="ui-sheet-up absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,.25)]">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-base font-semibold">
            {fr ? "Commande" : "Order"} n°{o.number}
          </p>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS[o.status].tone}`}>{STATUS[o.status][lang]}</span>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex h-8 w-8 items-center justify-center rounded-full bg-soft">
            ✕
          </button>
        </div>

        <ul className="mt-3 divide-y divide-line text-sm">
          {o.order_items.map((i, k) => (
            <li key={k} className="flex justify-between gap-3 py-2">
              <span>
                {i.quantity} × {i.name}
              </span>
              <span className="tabular-nums">{formatPrice(i.unit_price * i.quantity, o.currency)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex justify-between text-base font-semibold tabular-nums">
          <span>Total</span>
          <span>{formatPrice(o.total, o.currency)}</span>
        </p>
        <p className="mt-1 text-xs text-ink-3">
          {o.payment_method === "cod"
            ? fr
              ? "Paiement à la livraison"
              : "Cash on delivery"
            : o.payment_method === "credit"
              ? fr
                ? "À crédit : à valider avec le client"
                : "On credit: to agree with the customer"
              : o.payment_method}
          {o.payment_status === "paid" ? (fr ? " · payée" : " · paid") : ""}
        </p>

        <div className="ui-card mt-4 p-3 text-sm">
          <p className="font-medium">{o.customer_name}</p>
          <p className="text-ink-2">
            {o.address}, {o.city}
          </p>
          {o.customer_phone && <p className="text-ink-2 tabular-nums">+{o.customer_phone}</p>}
          {o.note && <p className="mt-1 text-ink-3">« {o.note} »</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {wa && (
              <a href={wa} target="_blank" rel="noopener" className="ui-btn ui-btn-secondary h-10">
                WhatsApp
              </a>
            )}
            {o.customer_phone && (
              <a href={`tel:+${o.customer_phone}`} className="ui-btn ui-btn-secondary h-10">
                {fr ? "Appeler" : "Call"}
              </a>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {next.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={busy}
              onClick={a.run}
              className={`ui-btn h-11 w-full ${a.primary ? "ui-btn-primary" : a.label === "Annuler" || a.label === "Cancel" ? "text-danger hover:bg-soft" : "ui-btn-secondary"}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
