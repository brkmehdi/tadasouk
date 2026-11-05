"use client";

// The cart page and the checkout, in the checkout's two columns: the order on the left (the
// store, the big total, lines, promotion, totals), the form on the right. On a phone the order
// folds into a "Détails" panel under a sticky bar with the store's name and the total.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPrice } from "@/lib/money";
import { phoneDigits } from "@/lib/phone";
import { delayText } from "@/lib/shop";
import { CardForm, useCardPayment } from "./CardPayment";
import { useCart } from "./cart";
import { PayButton, type PayState } from "./controls";
import { BackIcon, ChevronDown, LockIcon } from "./icons";
import { FreeShippingBar, Lines, Totals } from "./Summary";
import { suggestions, Upsell } from "./Upsell";

function StoreMark({ back }: { back: string }) {
  const { store } = useCart();
  return (
    <Link href={back} className="group -ms-6 inline-flex items-center gap-2 ps-6 text-[16px] font-bold tracking-[-0.03em] text-[#16151A]">
      <BackIcon size={12} className="-ms-5 text-ink-3 transition-transform group-hover:-translate-x-0.5" />
      {store.name}
      <span className="-ms-2 text-brand">.</span>
    </Link>
  );
}

function OrderColumn({ label, back, totalLabel }: { label: string; back: string; totalLabel: string }) {
  const { quote, store, lines, products, byId } = useCart();
  const offers = suggestions(products, lines.map((l) => byId.get(l.product_id)?.category ?? null), new Set(lines.map((l) => l.product_id)), 6);
  return (
    <>
      <div className="hidden md:block">
        <StoreMark back={back} />
        <p className="mt-8 text-[16px] font-medium text-ink-3">{label}</p>
        <p className={`mb-11 text-[36px] font-semibold tabular-nums tracking-[-0.03em] text-[#16151A] ${quote ? "" : "shop-amt-skel inline-block"}`}>
          {quote ? formatPrice(quote.total, store.currency) : "0 000,00 MAD"}
        </p>
      </div>
      <Lines />
      <div className="mt-4">
        <Totals totalLabel={totalLabel} />
      </div>
      <Upsell title="Ajoutez à votre commande" items={offers} />
    </>
  );
}

function ShippingChoice() {
  const { quote, store, setShipping } = useCart();
  if (!quote?.shipping_options.length) return null;
  const selected = quote.shipping?.id;
  return (
    <fieldset>
      <legend className="ui-label">Mode de livraison</legend>
      <div className="overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line),0_2px_4px_rgba(0,0,0,.07)]">
        {quote.shipping_options.map((s, i) => (
          <label key={s.id} className={`flex h-[52px] cursor-pointer items-center gap-3 px-3 hover:bg-[#f9f9f9] ${i ? "border-t border-[var(--line)]" : ""}`}>
            <input type="radio" name="shipping" checked={s.id === selected} onChange={() => setShipping(s.id)} className="shop-radio" />
            <span className="leading-tight">
              <span className={`block text-[13px] font-semibold ${s.id === selected ? "text-ink" : "text-ink-2"}`}>{s.name}</span>
              {delayText(s.delay_days) && <span className="block text-[11px] text-ink-3">{delayText(s.delay_days)}</span>}
            </span>
            <span className={`ms-auto text-[14px] font-semibold tabular-nums ${s.id === selected ? "text-ink" : "text-ink-2"}`}>
              {s.fee ? formatPrice(s.fee, store.currency) : "Gratuite"}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3">
        <FreeShippingBar />
      </div>
    </fieldset>
  );
}

function EmptyCart() {
  const { store } = useCart();
  return (
    <div className="mx-auto max-w-[380px] px-4 pt-24 text-center">
      <p className="text-[18px] font-medium">Votre panier est vide</p>
      <p className="mt-2 text-[14px] text-ink-3">Ajoutez des produits pour passer commande.</p>
      <Link href={`/${store.slug}/boutique`} className="ui-btn ui-btn-primary mt-6 h-11 px-6">
        Voir les produits
      </Link>
    </div>
  );
}

function Columns({ left, right, back }: { left: React.ReactNode; right: React.ReactNode; back: string }) {
  const [details, setDetails] = useState(false);
  return (
    <div className="min-h-dvh">
      <div className="md:hidden">
        <PhoneTopBar back={back} open={details} onToggle={() => setDetails(!details)} />
        {details && <div className="shop-fade-up border-b border-line px-4 pb-8">{left}</div>}
      </div>
      <div className="relative flex min-h-dvh flex-col items-center md:flex-row md:items-start md:justify-center md:gap-[160px] md:pt-12">
        <div className="pointer-events-none absolute inset-y-0 start-[calc(50%-24px)] hidden w-6 bg-gradient-to-r from-transparent to-black/5 md:block" />
        <div className="hidden w-[380px] md:block">{left}</div>
        <div className="w-full max-w-[380px] px-4 pb-16 md:px-0">{right}</div>
      </div>
    </div>
  );
}

function PhoneTopBar({ back, open, onToggle }: { back: string; open: boolean; onToggle: () => void }) {
  const { quote, store } = useCart();
  return (
    <>
      <div className="sticky top-0 z-30 flex h-[60px] items-center bg-white px-4">
        <span className="ps-6">
          <StoreMark back={back} />
        </span>
        <button type="button" onClick={onToggle} className="ms-auto inline-flex items-center gap-2 text-[13px] underline decoration-dotted underline-offset-2">
          {open ? "Fermer" : "Détails"}
          <ChevronDown size={10} className={open ? "rotate-180" : ""} />
        </button>
      </div>
      {!open && (
        <div className="px-4 pt-2 pb-6 text-center">
          <p className={`text-[28px] font-semibold tabular-nums tracking-[-0.03em] ${quote ? "" : "shop-amt-skel inline-block"}`}>
            {quote ? formatPrice(quote.total, store.currency) : "000,00 MAD"}
          </p>
        </div>
      )}
    </>
  );
}

export function CartPage() {
  const { store, lines, quote } = useCart();
  const router = useRouter();
  const [going, setGoing] = useState(false);
  if (!lines.length) return <EmptyCart />;
  const blocked = quote?.lines.some((l) => !l.ok) ?? false;
  const base = `/${store.slug}`;
  return (
    <Columns
      back={base}
      left={<OrderColumn label="Votre panier" back={base} totalLabel="Total" />}
      right={
        <div className="flex flex-col gap-6">
          <h2 className="text-[16px] font-bold tracking-[-0.01em]">Livraison</h2>
          {quote && !quote.shipping_options.length && (
            <p className="text-[14px] text-ink-2">Le vendeur vous confirme la livraison et son prix sur WhatsApp après la commande.</p>
          )}
          <ShippingChoice />
          <p className="text-[12px] text-ink-3">
            {store.city ? `Expédié depuis ${store.city}. ` : ""}
            {store.cod ? "Vous payez en espèces à la réception." : ""}
          </p>
          <PayButton
            state={going ? "busy" : blocked || !quote ? "idle" : "ready"}
            label="Commander"
            onClick={() => {
              if (blocked || !quote) return;
              setGoing(true);
              router.push(`${base}/paiement`);
            }}
          />
          <p className="-mt-3 text-center text-[13px] text-ink-3">Vous donnez votre adresse à l&apos;étape suivante.</p>
        </div>
      }
    />
  );
}

// `card`: the store takes cards through Tchentchen (switched on, and a key is set): Stripe's card
// form shows in this page through Tchentchen's SDK (CardPayment.tsx). The order is placed, then
// the card is charged. Without it, no card row.
export function CheckoutPage({ card = null }: { card?: { sdk: string } | null }) {
  const { store, lines, quote, promo, shippingId, clear } = useCart();
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState(store.city ?? "");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<"cod" | "credit" | "card">(store.cod ? "cod" : store.credit || !card ? "credit" : "card");
  const [state, setState] = useState<PayState>("ready");
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  // A card order placed whose payment did not go through: it stays as it is, the buyer pays again.
  const [placed, setPlaced] = useState<{ id: string; number?: number } | null>(null);
  const cardPay = useCardPayment(card?.sdk ?? null, !!card && payment === "card", {
    slug: store.slug,
    items: lines.map((l) => ({ product_id: l.product_id, quantity: l.qty, color_id: l.color_id, size: l.size })),
    shipping: quote?.shipping?.id ?? shippingId,
    promo,
    total: quote && !quote.lines.some((l) => !l.ok) ? quote.total : null,
    name,
    phone: phoneDigits(phone),
  });
  const choose = (m: "cod" | "credit" | "card") => {
    if (!placed) setPayment(m);
  };
  if (!lines.length && state !== "done") return <EmptyCart />;

  const base = `/${store.slug}`;
  const missing = {
    name: name.trim().length < 2,
    phone: phoneDigits(phone).length < 9,
    city: city.trim().length < 2,
    address: address.trim().length < 3,
  };
  const incomplete = Object.values(missing).some(Boolean);
  const blocked = quote?.lines.some((l) => !l.ok) ?? false;

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (incomplete || blocked || !quote) return;
    setState("busy");
    try {
      if (payment === "card") {
        const out = await cardPay.pay({ name, phone: phoneDigits(phone), city, address, note });
        if (out.kind === "paid") {
          setState("done");
          clear();
          router.push(`${base}/merci/${out.orderId}`);
        } else if (out.kind === "redirect") {
          setState("done");
          clear();
        } else {
          setState("ready");
          setError(out.message);
          if (out.orderId) setPlaced({ id: out.orderId, number: out.number });
        }
        return;
      }
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: store.slug,
          items: lines.map((l) => ({ product_id: l.product_id, quantity: l.qty, color_id: l.color_id, size: l.size })),
          name,
          phone: phoneDigits(phone),
          city,
          address,
          payment,
          note,
          shipping: quote.shipping?.id ?? shippingId,
          promo,
        }),
      });
      const body = (await res.json()) as { id?: string; message?: string };
      if (!res.ok || !body.id) throw new Error(body.message ?? "");
      setState("done");
      setTimeout(() => {
        clear();
        router.push(`${base}/merci/${body.id}`);
      }, 900);
    } catch (err) {
      setState("ready");
      setError(err instanceof Error && err.message ? err.message : "La commande n'est pas passée. Réessayez.");
    }
  };
  const err = (k: keyof typeof missing) => tried && missing[k];
  const busy = state === "busy" || state === "done";

  return (
    <Columns
      back={`${base}/panier`}
      left={<OrderColumn label={`Payer ${store.name}`} back={`${base}/panier`} totalLabel="Total à payer" />}
      right={
        <form onSubmit={(e) => void pay(e)} noValidate className={`flex flex-col gap-7 ${busy ? "pointer-events-none opacity-80" : ""}`}>
          <section>
            <h2 className="mb-4 text-[16px] font-bold tracking-[-0.01em]">Vos coordonnées</h2>
            <label className="ui-label" htmlFor="ck-phone">
              Téléphone (WhatsApp)
            </label>
            <input
              id="ck-phone"
              className={`ui-input ${err("phone") ? "shadow-[0_0_0_1px_rgb(239,152,150)]" : ""}`}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              inputMode="tel"
              placeholder="06 12 34 56 78"
            />
            {err("phone") && <p className="shop-fade-up mt-1.5 text-[13px] text-danger">Votre numéro, pour que le vendeur vous confirme la commande.</p>}
          </section>

          <section>
            <p className="ui-label">Adresse de livraison</p>
            <div className="shop-group">
              <input aria-label="Nom complet" placeholder="Nom complet" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
              <input aria-label="Adresse" placeholder="Adresse (rue, quartier, repère)" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" maxLength={300} />
              <input aria-label="Ville" placeholder="Ville" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" maxLength={60} />
            </div>
            {(err("name") || err("address") || err("city")) && (
              <p className="shop-fade-up mt-1.5 text-[13px] text-danger">Votre nom, votre adresse et votre ville sont nécessaires pour la livraison.</p>
            )}
            <input
              className="ui-input mt-3"
              placeholder="Note pour le vendeur (facultatif)"
              aria-label="Note pour le vendeur"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
            />
          </section>

          <ShippingChoice />

          <section>
            <h2 className="mb-3 text-[16px] font-medium">Moyen de paiement</h2>
            <div className="overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line),0_2px_4px_rgba(0,0,0,.07)]">
              {store.cod && (
                <PayRow checked={payment === "cod"} onChange={() => choose("cod")} title="Paiement à la livraison" hint="En espèces, quand vous recevez la commande." />
              )}
              {store.credit && (
                <PayRow checked={payment === "credit"} onChange={() => choose("credit")} title="À crédit" hint="Le vendeur vous propose des échéances après validation." />
              )}
              {card && (
                <PayRow
                  checked={payment === "card"}
                  onChange={() => choose("card")}
                  title="Carte bancaire"
                  hint="Visa, Mastercard, Apple Pay ou Google Pay."
                  extra={<CardBrands />}
                />
              )}
            </div>
            {card && (
              <div className={payment === "card" ? "" : "hidden"}>
                <CardForm card={cardPay} />
              </div>
            )}
          </section>

          <div>
            {error && <p className="shop-fade-up mb-3 text-[14px] text-danger">{error}</p>}
            {placed && (
              <p className="mb-3 text-[13px] text-ink-2">
                Votre commande{placed.number ? ` n°${placed.number}` : ""} est enregistrée, mais pas encore payée. Réessayez, ou{" "}
                <Link href={`${base}/merci/${placed.id}`} className="underline underline-offset-2">
                  payez plus tard depuis la page de la commande
                </Link>
                .
              </p>
            )}
            <PayButton
              type="submit"
              state={state === "ready" ? (incomplete || blocked || !quote ? "idle" : "ready") : state}
              label={
                payment === "card"
                  ? quote
                    ? `Payer ${formatPrice(quote.total, store.currency)}`
                    : "Payer"
                  : quote
                    ? `Commander · ${formatPrice(quote.total, store.currency)}`
                    : "Commander"
              }
              busyLabel={payment === "card" ? "Paiement en cours" : "Envoi de la commande"}
              doneLabel={payment === "card" ? "Paiement accepté" : "Commande envoyée"}
            />
            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[13px] text-ink-3">
              <LockIcon size={12} />
              {payment === "card"
                ? "Paiement sécurisé par Tchentchen. Vos données de carte ne passent pas par la boutique."
                : "Le vendeur vous confirme la commande sur WhatsApp."}
            </p>
            {card && (
              <p className="mt-1.5 text-center text-[11px] text-ink-3">Tchentchen, service de paiement existant (antérieur au hackathon)</p>
            )}
          </div>
        </form>
      }
    />
  );
}

// Small card marks drawn here (no logo files): a generic card, Apple Pay and Google Pay chips.
function CardBrands() {
  const chip = "inline-flex h-5 items-center rounded-[4px] border border-black/10 bg-white px-1.5 text-[10px] font-semibold tracking-tight text-[#1a1a1a]";
  return (
    <span className="mt-2 flex flex-wrap gap-1.5">
      <span className={chip}>VISA</span>
      <span className={chip}>
        <span className="me-0.5 inline-block h-2.5 w-2.5 rounded-full bg-[#eb001b]" />
        <span className="-ms-1.5 me-1 inline-block h-2.5 w-2.5 rounded-full bg-[#f79e1b] mix-blend-multiply" />
        Mastercard
      </span>
      <span className={chip}>Apple Pay</span>
      <span className={chip}>Google Pay</span>
    </span>
  );
}

function PayRow(props: { checked: boolean; disabled?: boolean; onChange: () => void; title: string; hint: string; extra?: React.ReactNode }) {
  return (
    <label className={`flex items-start gap-3 border-[var(--line)] px-4 py-3.5 [&+&]:border-t ${props.disabled ? "opacity-50" : "cursor-pointer hover:bg-[#f9f9f9]"}`}>
      <input type="radio" name="payment" checked={props.checked} disabled={props.disabled} onChange={props.onChange} className="shop-radio mt-0.5" />
      <span>
        <span className={`block text-[14px] font-medium ${props.checked ? "text-brand" : ""}`}>{props.title}</span>
        <span className="block text-[13px] text-ink-3">{props.hint}</span>
        {props.extra}
      </span>
    </label>
  );
}
