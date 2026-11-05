"use client";

// Sales: the orders of the online store (newest first) and the counter sale. An order moves
// along: confirmed, shipped with a delivery partner, delivered and paid (cash on delivery
// records the payment), or cancelled. The customer is one tap away on WhatsApp, and gets a
// tracking link once the parcel leaves.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CatalogProduct } from "@/lib/catalog/types";
import {
  PARTNERS,
  SHIPMENT_COLUMNS,
  STEPS,
  deliveryKind,
  findCity,
  nextStatus,
  partnerFee,
  stepIndex,
  trackingCode,
  type DeliveryKind,
  type Shipment,
  type ShipmentStatus,
} from "@/lib/delivery";
import { DeliveryMap } from "@/lib/delivery-map";
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

// Words of the shipping flow (i18n.tsx is shared, so they stay here).
const TX = {
  shipWith: { fr: "Expédier avec un livreur", en: "Ship with a delivery partner" },
  shipTitle: { fr: "Expédier avec", en: "Ship with" },
  recommended: { fr: "Conseillé", en: "Best match" },
  sameCity: { fr: "Même ville : un coursier passe prendre le colis.", en: "Same city: a courier picks the parcel up." },
  otherCity: { fr: "Autre ville : le colis part par messagerie.", en: "Another city: the parcel goes by parcel network." },
  noStoreCity: { fr: "Ajoutez la ville de la boutique dans Réglages pour un trajet exact.", en: "Add the shop's city in Settings for an exact route." },
  confirmShip: { fr: "Confirmer l'expédition", en: "Confirm shipment" },
  back: { fr: "Retour", en: "Back" },
  shipFailed: { fr: "L'expédition n'a pas été créée. Réessayez.", en: "The shipment was not created. Try again." },
  sendTracking: { fr: "Envoyer le suivi", en: "Send tracking" },
  openTracking: { fr: "Page de suivi", en: "Tracking page" },
  delivered: { fr: "Livrée", en: "Delivered" },
  deliveredPaid: { fr: "Livrée et payée", en: "Delivered and paid" },
  card: { fr: "Carte bancaire (Tchentchen)", en: "Card (Tchentchen)" },
  cardCounter: { fr: "Carte en boutique (Tchentchen)", en: "Card in the shop (Tchentchen)" },
  cancelRefund: { fr: "Annuler et rembourser", en: "Cancel and refund" },
  refundFailed: {
    fr: "Le remboursement n'est pas passé : la commande n'est pas annulée. Réessayez.",
    en: "The refund did not go through: the order is not cancelled. Try again.",
  },
  refunded: { fr: " · remboursée", en: " · refunded" },
} as const;

// The merchant's button for each next step of a shipment ("in transit" leads to the order's
// own "delivered" action, which also records a cash on delivery payment).
const ADVANCE: Record<ShipmentStatus, { fr: string; en: string } | null> = {
  created: { fr: "Colis récupéré par le livreur", en: "Parcel picked up" },
  picked_up: { fr: "Colis en route", en: "Parcel on the way" },
  in_transit: null,
  delivered: null,
  failed: null,
};

const partnerName = (fr: string, lang: "fr" | "en") => Object.values(PARTNERS).find((p) => p.name.fr === fr)?.name[lang] ?? fr;

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
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [picking, setPicking] = useState(false);
  const [cancelError, setCancelError] = useState(false);
  const fr = lang === "fr";

  // A card order is cancelled by the server: it refunds what was paid through Tchentchen and
  // cancels what is still open, then cancels the order.
  const cancelCard = async () => {
    setBusy(true);
    setCancelError(false);
    const res = await fetch("/api/pay/cancel-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: o.id }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.refresh();
    else setCancelError(true);
  };

  // The back office does not load shipments: read this order's one when the sheet opens.
  useEffect(() => {
    let live = true;
    void supabase()
      .from("shipments")
      .select(SHIPMENT_COLUMNS)
      .eq("order_id", o.id)
      .maybeSingle<Shipment>()
      .then(({ data }) => {
        if (live) setShipment(data ?? null);
      });
    return () => {
      live = false;
    };
  }, [o.id]);

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
  const codPay = o.payment_method === "cod" && o.payment_status !== "paid";

  const wa = o.customer_phone
    ? `https://wa.me/${o.customer_phone}?text=${encodeURIComponent(
        fr
          ? `Bonjour ${o.customer_name ?? ""}, c'est ${store.name}. Votre commande n°${o.number} (${formatPrice(o.total, o.currency)}) est bien reçue.`
          : `Hello ${o.customer_name ?? ""}, this is ${store.name}. Your order #${o.number} (${formatPrice(o.total, o.currency)}) is received.`,
      )}`
    : null;

  const next: { label: string; run: () => void; primary?: boolean; danger?: boolean }[] = [];
  if (o.status === "pending") next.push({ label: fr ? "Confirmer la commande" : "Confirm the order", run: () => void move("confirmed"), primary: true });
  if (o.status === "confirmed") next.push({ label: TX.shipWith[lang], run: () => setPicking(true), primary: true });
  if ((o.status === "shipped" && !shipment) || o.status === "confirmed")
    next.push({
      label: o.payment_method === "cod" ? TX.deliveredPaid[lang] : TX.delivered[lang],
      run: () => void move("delivered", codPay),
      primary: o.status === "shipped",
    });
  if (o.status !== "delivered" && o.status !== "cancelled") {
    const paidCard = o.payment_method === "card" && (o.payment_status === "paid" || o.payment_status === "partial");
    next.push({
      label: paidCard ? TX.cancelRefund[lang] : fr ? "Annuler" : "Cancel",
      run: () => void (o.payment_method === "card" ? cancelCard() : move("cancelled")),
      danger: true,
    });
  }

  const payLabel =
    o.payment_method === "cod"
      ? fr
        ? "Paiement à la livraison"
        : "Cash on delivery"
      : o.payment_method === "credit"
        ? fr
          ? "À crédit : à valider avec le client"
          : "On credit: to agree with the customer"
        : o.payment_method === "card"
          ? TX.card[lang]
          : o.payment_method === "card_counter"
            ? TX.cardCounter[lang]
            : o.payment_method;

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

        {picking ? (
          <ShipPicker
            store={store}
            o={o}
            onBack={() => setPicking(false)}
            onShipped={(s) => {
              setShipment(s);
              setPicking(false);
              router.refresh();
            }}
          />
        ) : (
          <>
            {shipment && <ShipmentCard store={store} o={o} s={shipment} busy={busy} onChange={setShipment} onDelivered={() => move("delivered", codPay)} />}

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
              {payLabel}
              {o.payment_status === "paid" ? (fr ? " · payée" : " · paid") : o.payment_status === "refunded" ? TX.refunded[lang] : ""}
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
                  className={`ui-btn h-11 w-full ${a.primary ? "ui-btn-primary" : a.danger ? "text-danger hover:bg-soft" : "ui-btn-secondary"}`}
                >
                  {a.label}
                </button>
              ))}
              {cancelError && <p className="text-center text-sm text-danger">{TX.refundFailed[lang]}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/// "Ship with": the partner that fits the trip (same city or not), its fee and delay, the route
// on the map, and one tap to create the shipment and its tracking code.
function ShipPicker({ store, o, onBack, onShipped }: { store: Store; o: Order; onBack: () => void; onShipped: (s: Shipment) => void }) {
  const { lang } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const best: DeliveryKind = deliveryKind(store.city, o.city);
  const [kind, setKind] = useState<DeliveryKind>(best);
  const from = findCity(store.city)?.name ?? store.city;
  const to = findCity(o.city)?.name ?? o.city;

  const create = async () => {
    setBusy(true);
    setError(false);
    const db = supabase();
    const partner = PARTNERS[kind].name.fr;
    const at = new Date().toISOString();
    // A tracking code already taken (unlikely) gets a new draw.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = trackingCode();
      const { data, error: err } = await db
        .from("shipments")
        .insert({
          store_id: store.id,
          order_id: o.id,
          partner,
          kind,
          fee: partnerFee(kind, store.currency),
          from_city: store.city,
          to_city: o.city,
          tracking: code,
          status: "created",
          events: [{ status: "created", at }],
        })
        .select(SHIPMENT_COLUMNS)
        .single<Shipment>();
      if (data) {
        await db.from("orders").update({ status: "shipped", shipping_name: partner, tracking: code }).eq("id", o.id);
        setBusy(false);
        onShipped(data);
        return;
      }
      if (err?.code !== "23505" || !err.message.includes("tracking")) break;
    }
    setBusy(false);
    setError(true);
  };

  return (
    <div className="mt-4">
      <p className="text-base font-medium">{TX.shipTitle[lang]}</p>
      <p className="text-[13px] text-ink-3">
        {from ?? "?"} → {to ?? "?"}
      </p>
      <div className="mt-3">
        <DeliveryMap key={kind} from={store.city} to={o.city} kind={kind} status="created" seed={o.id} lang={lang} />
      </div>
      <p className="mt-3 text-[13px] text-ink-3">{!store.city ? TX.noStoreCity[lang] : best === "local" ? TX.sameCity[lang] : TX.otherCity[lang]}</p>

      <div className="ui-card mt-3 divide-y divide-line rounded-xl" role="radiogroup" aria-label={TX.shipTitle[lang]}>
        {(["local", "intercity"] as const).map((k) => {
          const p = PARTNERS[k];
          return (
            <label key={k} className="flex cursor-pointer items-center gap-3 p-3">
              <input type="radio" name="partner" className="shop-radio" checked={k === kind} onChange={() => setKind(k)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {p.name[lang]}
                  {k === best && <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[11px] font-medium text-ok">{TX.recommended[lang]}</span>}
                </span>
                <span className="block text-[13px] text-ink-3">{p.delay[lang]}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums">{formatPrice(partnerFee(k, store.currency), store.currency)}</span>
            </label>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{TX.shipFailed[lang]}</p>}
      <div className="mt-4 flex flex-col gap-2">
        <button type="button" disabled={busy} onClick={() => void create()} className="ui-btn ui-btn-primary h-11 w-full">
          {busy ? "…" : `${TX.confirmShip[lang]} · ${formatPrice(partnerFee(kind, store.currency), store.currency)}`}
        </button>
        <button type="button" disabled={busy} onClick={onBack} className="ui-btn h-11 w-full text-ink-2 hover:bg-soft">
          {TX.back[lang]}
        </button>
      </div>
    </div>
  );
}

// The shipment of an order: the map, the steps, the next step for the merchant (picked up, on
// the way, delivered), and the tracking link for the customer.
function ShipmentCard({
  store,
  o,
  s,
  busy,
  onChange,
  onDelivered,
}: {
  store: Store;
  o: Order;
  s: Shipment;
  busy: boolean;
  onChange: (s: Shipment) => void;
  onDelivered: () => Promise<void>;
}) {
  const { lang } = useT();
  const [saving, setSaving] = useState(false);
  const step = stepIndex(s.status);
  const delivered = s.status === "delivered";
  const link = `${typeof window === "undefined" ? "" : window.location.origin}/${store.slug}/suivi/${s.tracking}`;
  const to = findCity(s.to_city)?.name ?? s.to_city;

  const advance = async () => {
    const status = nextStatus(s.status);
    if (!status) return;
    setSaving(true);
    const at = new Date().toISOString();
    const { data } = await supabase()
      .from("shipments")
      .update({ status, events: [...s.events, { status, at }], updated_at: at })
      .eq("id", s.id)
      .select(SHIPMENT_COLUMNS)
      .single<Shipment>();
    if (data) onChange(data);
    if (data && status === "delivered") await onDelivered();
    setSaving(false);
  };

  const waTrack = o.customer_phone
    ? `https://wa.me/${o.customer_phone}?text=${encodeURIComponent(
        lang === "fr"
          ? `Bonjour ${o.customer_name ?? ""}, c'est ${store.name}. Votre commande n°${o.number} est partie avec notre livreur (${s.partner}). Suivez-la ici : ${link}`
          : `Hello ${o.customer_name ?? ""}, this is ${store.name}. Your order #${o.number} is on its way with our delivery partner (${partnerName(s.partner, "en")}). Track it here: ${link}`,
      )}`
    : null;

  const nextLabel = ADVANCE[s.status]?.[lang] ?? (s.status === "in_transit" ? (o.payment_method === "cod" ? TX.deliveredPaid[lang] : TX.delivered[lang]) : null);

  return (
    <div className="ui-card mt-4 overflow-hidden rounded-xl">
      <DeliveryMap key={s.status} from={s.from_city} to={s.to_city} kind={s.kind} status={s.status} seed={s.tracking} lang={lang} bare />
      <div className="border-t border-line p-3">
        <div className="flex items-baseline gap-2">
          <p className={`flex-1 text-sm font-semibold ${delivered ? "text-ok" : ""}`}>
            {STEPS[step][lang]}
            {s.status === "in_transit" && to && s.kind !== "local" ? (lang === "fr" ? ` vers ${to}` : ` to ${to}`) : ""}
          </p>
          <span className="font-mono text-[13px] text-ink-3">{s.tracking}</span>
        </div>
        <p className="text-[13px] text-ink-3">
          {partnerName(s.partner, lang)} · <span className="tabular-nums">{formatPrice(Number(s.fee), store.currency)}</span>
        </p>

        <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden>
          {STEPS.map((st, i) => (
            <span key={st.status} className="flex min-w-0 flex-col gap-1">
              <span className={`h-1 rounded-full ${i <= step ? (delivered ? "bg-ok" : "bg-ink") : "bg-line"}`} />
              <span className={`truncate text-[11px] ${i <= step ? "text-ink-2" : "text-ink-3"}`}>{st[lang]}</span>
            </span>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {waTrack && (
            <a href={waTrack} target="_blank" rel="noopener" className="ui-btn ui-btn-secondary">
              {TX.sendTracking[lang]}
            </a>
          )}
          <a href={link} target="_blank" rel="noopener" className={`ui-btn ui-btn-secondary ${waTrack ? "" : "col-span-2"}`}>
            {TX.openTracking[lang]}
          </a>
        </div>

        {nextLabel && (
          <button type="button" disabled={busy || saving} onClick={() => void advance()} className="ui-btn ui-btn-primary mt-2 h-11 w-full">
            {saving ? "…" : nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}
