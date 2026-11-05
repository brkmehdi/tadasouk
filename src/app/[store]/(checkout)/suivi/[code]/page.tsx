// The customer's tracking page, the link the seller sends on WhatsApp: where the parcel is on
// the map, the steps so far, and who carries it. The store's slug and the tracking code are the
// only keys; the page shows cities and the customer's first name, never the address or phone.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PARTNERS, STEPS, TRACKING_RE, findCity, stepIndex, type DeliveryKind, type ShipmentEvent, type ShipmentStatus } from "@/lib/delivery";
import { DeliveryMap } from "@/lib/delivery-map";
import { withDb } from "@/lib/server/db";
import { loadStore } from "@/lib/storefront";
import { CircleCheck } from "../../../_ui/icons";
import { Refresh } from "./Refresh";

export const metadata: Metadata = { title: "Suivi de commande", robots: { index: false } };

type Params = { params: Promise<{ store: string; code: string }> };
type Row = {
  partner: string;
  kind: DeliveryKind;
  from_city: string | null;
  to_city: string | null;
  tracking: string;
  status: ShipmentStatus;
  events: ShipmentEvent[];
  number: number;
  customer_name: string | null;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("fr-MA", { timeZone: "Africa/Casablanca", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function Suivi({ params }: Params) {
  const { store: slug, code: raw } = await params;
  const code = decodeURIComponent(raw).toUpperCase();
  if (!TRACKING_RE.test(code)) notFound();
  const found = await loadStore(slug);
  if (!found) notFound();
  const { store } = found;
  const [s] = await withDb(
    (sql) => sql<Row[]>`
      select sh.partner, sh.kind, sh.from_city, sh.to_city, sh.tracking, sh.status, sh.events, o.number, o.customer_name
      from public.shipments sh
      join public.stores st on st.id = sh.store_id
      join public.orders o on o.id = sh.order_id
      where st.slug = ${slug} and sh.tracking = ${code}`,
  );
  if (!s) notFound();

  const step = stepIndex(s.status);
  const delivered = s.status === "delivered";
  const to = findCity(s.to_city)?.name ?? s.to_city;
  const from = findCity(s.from_city)?.name ?? s.from_city;
  const at = new Map(s.events.map((e) => [e.status, e.at]));
  const first = s.customer_name?.split(" ")[0];
  const headline = {
    created: "Votre colis est prêt à partir",
    picked_up: "Le livreur a récupéré votre colis",
    in_transit: s.kind === "local" ? "Le coursier est en route vers vous" : to ? `En route vers ${to}` : "Votre colis est en route",
    delivered: "Votre commande est livrée",
    failed: "La livraison n'a pas pu se faire",
  }[s.status];
  const partner = Object.values(PARTNERS).find((p) => p.name.fr === s.partner);
  const message = `Bonjour, je suis la commande n°${s.number} (suivi ${s.tracking}).`;

  return (
    <main className="mx-auto max-w-[420px] px-4 pt-14 pb-20">
      {!delivered && <Refresh />}
      <Link href={`/${store.slug}`} className="text-[16px] font-bold tracking-[-0.03em] text-[#16151A]">
        {store.name}
        <span className="text-brand">.</span>
      </Link>

      <div className="shop-fade-up mt-10 flex flex-col items-center text-center">
        {delivered && <CircleCheck size={44} className="mb-4 text-ok" />}
        <p className="text-[13px] text-ink-3">
          {first ? `${first}, ` : ""}commande n°{s.number}
        </p>
        <h1 className="mt-1 text-[26px] leading-tight font-extrabold tracking-[-0.035em]">{headline}</h1>
        <p className="mt-2 text-[15px] text-ink-2">
          {s.partner}
          {partner && !delivered ? ` · ${partner.delay.fr}` : ""}
        </p>
      </div>

      <div className="mt-8">
        <DeliveryMap key={s.status} from={s.from_city} to={s.to_city} kind={s.kind} status={s.status} seed={s.tracking} />
      </div>

      <ol className="mt-8 flex flex-col border-t border-line pt-6">
        {STEPS.map((st, i) => {
          const done = i <= step;
          return (
            <li key={st.status} className="relative flex gap-3 pb-5 last:pb-0">
              {i < STEPS.length - 1 && (
                <span className={`absolute start-[5px] top-[18px] bottom-0 w-px ${i < step ? (delivered ? "bg-ok" : "bg-ink") : "bg-line"}`} aria-hidden />
              )}
              <span
                className={`relative mt-[5px] h-[11px] w-[11px] shrink-0 rounded-full ${
                  done ? (delivered ? "bg-ok" : "bg-ink") : "bg-white shadow-[inset_0_0_0_1.5px_var(--line)]"
                }`}
                aria-hidden
              />
              <span className="min-w-0">
                <span className={`block text-[14px] ${done ? "font-medium" : "text-ink-3"}`}>
                  {st.status === "in_transit" && to && s.kind !== "local" ? `${st.fr} vers ${to}` : st.fr}
                </span>
                {at.get(st.status) && <span className="block text-[12px] text-ink-3 capitalize">{when(at.get(st.status)!)}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <dl className="mt-6 flex flex-col gap-2 border-t border-line pt-4 text-[14px]">
        <div className="flex justify-between gap-3">
          <dt>Numéro de suivi</dt>
          <dd className="font-mono">{s.tracking}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Livreur</dt>
          <dd>{s.partner}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Trajet</dt>
          <dd className="text-end">{s.kind === "local" ? `Dans ${to ?? from ?? "la ville"}` : `${from ?? "?"} → ${to ?? "?"}`}</dd>
        </div>
      </dl>

      <div className="mt-8 flex flex-col gap-3">
        {store.whatsapp && (
          <a href={`https://wa.me/${store.whatsapp}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener" className="ui-btn ui-btn-primary h-12 text-[16px]">
            Une question ? Écrire à {store.name}
          </a>
        )}
        <Link href={`/${store.slug}`} className="ui-btn ui-btn-secondary h-12 text-[16px] text-ink">
          Voir la boutique
        </Link>
      </div>
    </main>
  );
}
