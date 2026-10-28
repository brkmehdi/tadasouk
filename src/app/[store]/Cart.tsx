"use client";

// The customer's basket for one store, kept in this browser (localStorage), and the order form:
// name, phone, city, address, payment. The server prices the order from the published products;
// the basket only says which products and how many.

import Link from "next/link";
import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { formatPrice } from "@/lib/money";
import { phoneDigits } from "@/lib/phone";

export type CartStore = {
  slug: string;
  name: string;
  currency: string;
  whatsapp: string | null;
  cod: boolean;
  credit: boolean;
};
type Line = { id: string; name: string; price: number; image: string | null; qty: number };

// One tiny store per browser: the lines of each shop, shared by every component on the page.
const listeners = new Set<() => void>();
const key = (slug: string) => `smallstore.cart.${slug}`;
let cache: { k: string; raw: string | null; lines: Line[] } = { k: "", raw: null, lines: [] };
const EMPTY: Line[] = [];

function read(slug: string): Line[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(slug));
  } catch {
    return EMPTY;
  }
  if (cache.k === slug && cache.raw === raw) return cache.lines;
  let lines: Line[] = [];
  try {
    lines = raw ? (JSON.parse(raw) as Line[]) : [];
  } catch {
    lines = [];
  }
  cache = { k: slug, raw, lines };
  return lines;
}

function write(slug: string, lines: Line[]) {
  try {
    localStorage.setItem(key(slug), JSON.stringify(lines));
  } catch {
    // private mode: the basket lives as long as the page
    cache = { k: slug, raw: JSON.stringify(lines), lines };
  }
  listeners.forEach((l) => l());
}

const Ctx = createContext<{ store: CartStore; lines: Line[]; set: (lines: Line[]) => void } | null>(null);

export function CartProvider({ store, children }: { store: CartStore; children: React.ReactNode }) {
  const lines = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => read(store.slug),
    () => EMPTY,
  );
  return <Ctx.Provider value={{ store, lines, set: (next) => write(store.slug, next) }}>{children}</Ctx.Provider>;
}

function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}

export function AddToCart({ product }: { product: { id: string; name: string; price: number | null; image: string | null } }) {
  const { lines, set } = useCart();
  const [added, setAdded] = useState(0);
  if (product.price == null) return <p className="text-sm text-ink-3">Prix sur demande : écrivez au vendeur.</p>;
  const add = () => {
    const found = lines.find((l) => l.id === product.id);
    set(
      found
        ? lines.map((l) => (l.id === product.id ? { ...l, qty: Math.min(99, l.qty + 1) } : l))
        : [...lines, { id: product.id, name: product.name, price: product.price!, image: product.image, qty: 1 }],
    );
    setAdded((n) => n + 1);
  };
  return (
    <button type="button" onClick={add} className="ui-btn ui-btn-primary h-12 w-full text-base">
      {added ? "Ajouté au panier ✓" : "Ajouter au panier"}
    </button>
  );
}

export function CartBar() {
  const { store, lines } = useCart();
  const [open, setOpen] = useState(false);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((n, l) => n + l.qty * l.price, 0);
  return (
    <>
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white via-white/95 to-white/0 px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ui-btn ui-btn-primary mx-auto flex h-12 w-full max-w-lg justify-between px-5 text-base"
          >
            <span>Panier · {count}</span>
            <span className="tabular-nums">{formatPrice(total, store.currency)}</span>
          </button>
        </div>
      )}
      {open && <Checkout onClose={() => setOpen(false)} />}
    </>
  );
}

type Done = { number: number; total: number };

function Checkout({ onClose }: { onClose: () => void }) {
  const { store, lines, set } = useCart();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<"cod" | "credit">(store.cod ? "cod" : "credit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const total = lines.reduce((n, l) => n + l.qty * l.price, 0);

  const qty = (id: string, d: number) =>
    set(lines.map((l) => (l.id === id ? { ...l, qty: Math.max(0, Math.min(99, l.qty + d)) } : l)).filter((l) => l.qty > 0));

  const order = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: store.slug,
          items: lines.map((l) => ({ product_id: l.id, quantity: l.qty })),
          name,
          phone: phoneDigits(phone),
          city,
          address,
          payment,
          note,
        }),
      });
      const body = (await res.json()) as Done & { message?: string };
      if (!res.ok) throw new Error(body.message ?? "error");
      set([]);
      setDone(body);
    } catch (err) {
      setError(err instanceof Error && err.message !== "error" ? err.message : "La commande n'est pas passée. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  const toSeller = (d: Done) =>
    `https://wa.me/${store.whatsapp}?text=${encodeURIComponent(
      `Bonjour, je viens de passer la commande n°${d.number} (${formatPrice(d.total, store.currency)}) sur votre boutique ${store.name}.`,
    )}`;

  return (
    <div className="fixed inset-0 z-40">
      <div className="ui-scrim" onClick={onClose} />
      <div className="ui-sheet-up absolute inset-x-0 bottom-0 mx-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 text-ink pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,.25)]">
        <div className="flex items-center">
          <h2 className="flex-1 text-base font-semibold">{done ? "Commande envoyée" : "Votre panier"}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="flex h-8 w-8 items-center justify-center rounded-full bg-soft">
            ✕
          </button>
        </div>

        {done ? (
          <div className="mt-4 text-sm">
            <p>
              Merci ! Votre commande n°{done.number} de {formatPrice(done.total, store.currency)} est enregistrée. Le vendeur vous contacte
              pour la livraison.
            </p>
            {store.whatsapp && (
              <a href={toSeller(done)} target="_blank" rel="noopener" className="ui-btn ui-btn-secondary mt-4 h-11 w-full">
                Écrire au vendeur sur WhatsApp
              </a>
            )}
            <Link href={`/${store.slug}`} onClick={onClose} className="mt-3 block text-center text-sm font-medium text-brand">
              Continuer mes achats
            </Link>
          </div>
        ) : lines.length === 0 ? (
          <p className="mt-4 text-sm text-ink-3">Votre panier est vide.</p>
        ) : (
          <form className="mt-3 flex flex-col gap-4" onSubmit={(e) => void order(e)}>
            <ul className="divide-y divide-line">
              {lines.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2.5">
                  <span className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-line">
                    {l.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.image} alt="" className="h-full w-full object-contain" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{l.name}</span>
                    <span className="block text-sm text-ink-3 tabular-nums">{formatPrice(l.price, store.currency)}</span>
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    <button type="button" onClick={() => qty(l.id, -1)} aria-label="Moins" className="h-8 w-8 rounded-full bg-soft">
                      −
                    </button>
                    {l.qty}
                    <button type="button" onClick={() => qty(l.id, 1)} aria-label="Plus" className="h-8 w-8 rounded-full bg-soft">
                      +
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between text-base font-semibold tabular-nums">
              <span>Total</span>
              <span>{formatPrice(total, store.currency)}</span>
            </p>

            <label className="block">
              <span className="ui-label">Nom</span>
              <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={80} />
            </label>
            <label className="block">
              <span className="ui-label">Téléphone (WhatsApp)</span>
              <input className="ui-input" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" placeholder="06 12 34 56 78" required />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="ui-label">Ville</span>
                <input className="ui-input" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" required maxLength={60} />
              </label>
              <label className="block">
                <span className="ui-label">Adresse</span>
                <input className="ui-input" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" required maxLength={300} />
              </label>
            </div>
            <label className="block">
              <span className="ui-label">Note pour le vendeur (facultatif)</span>
              <input className="ui-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </label>

            <fieldset className="flex flex-col gap-2">
              <legend className="ui-label">Paiement</legend>
              {store.cod && (
                <PayOption checked={payment === "cod"} onChange={() => setPayment("cod")} title="Paiement à la livraison" hint="Vous payez en espèces à la réception." />
              )}
              {store.credit && (
                <PayOption checked={payment === "credit"} onChange={() => setPayment("credit")} title="À crédit" hint="Le vendeur vous propose des échéances après validation." />
              )}
              <PayOption checked={false} disabled onChange={() => {}} title="Carte bancaire" hint="Bientôt disponible." />
            </fieldset>

            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy} className="ui-btn ui-btn-primary h-12 w-full text-base">
              Commander · {formatPrice(total, store.currency)}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function PayOption(props: { checked: boolean; disabled?: boolean; onChange: () => void; title: string; hint: string }) {
  return (
    <label className={`ui-card flex items-start gap-3 p-3 ${props.disabled ? "opacity-50" : "cursor-pointer"} ${props.checked ? "ring-2 ring-brand" : ""}`}>
      <input type="radio" name="payment" className="mt-1" checked={props.checked} disabled={props.disabled} onChange={props.onChange} />
      <span>
        <span className="block text-sm font-medium">{props.title}</span>
        <span className="block text-xs text-ink-3">{props.hint}</span>
      </span>
    </label>
  );
}

export function ShareOnWhatsApp({ text, url, className = "" }: { text: string; url: string; className?: string }) {
  return (
    <a
      href={`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`}
      target="_blank"
      rel="noopener"
      className={`ui-btn ui-btn-secondary h-11 ${className}`}
    >
      Partager sur WhatsApp
    </a>
  );
}
