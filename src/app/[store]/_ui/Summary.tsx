"use client";

// The order as the database prices it: lines (photo, colour and size, quantity chip, price),
// then subtotal, promotion code, delivery and total. The same block sits in the cart drawer,
// the cart page and the checkout; amounts shimmer while a new price is on its way.

import { useState } from "react";
import { mediaUrl } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/money";
import { freeFrom, PROMO_ERRORS } from "@/lib/shop";
import { useCart, type Line } from "./cart";
import { QtyPicker } from "./controls";
import { ChevronDown, CloseIcon } from "./icons";

export function useLineView() {
  const { byId, quote, lines } = useCart();
  return (l: Line, i: number) => {
    const p = byId.get(l.product_id);
    const q = quote?.lines[i];
    const color = p?.colors.find((c) => c.id === l.color_id);
    const image = q?.image ? mediaUrl(q.image) : (color?.cover ?? p?.cover ?? null);
    const desc = [color?.name ?? q?.color, l.size && `taille ${l.size}`].filter(Boolean).join(", ");
    const unit = q?.unit_price ?? p?.price ?? null;
    return { name: q?.name ?? p?.name ?? "Produit", image, desc, unit, ok: q ? q.ok : true, total: lines.length };
  };
}

export function Lines({ editable = true }: { editable?: boolean }) {
  const { lines, setQty, store } = useCart();
  const view = useLineView();
  const [editing, setEditing] = useState<string | null>(null);
  const line = lines.find((l) => l.key === editing);
  return (
    <>
      <ul className="flex flex-col gap-4">
        {lines.map((l, i) => {
          const v = view(l, i);
          return (
            <li key={l.key} className="flex items-start gap-4">
              <span className="h-[42px] w-[42px] shrink-0 overflow-hidden rounded bg-[#f2f2f2]">
                {v.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.image} alt="" className="h-full w-full object-contain mix-blend-multiply" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 pt-0.5 text-[14px] font-medium leading-[18px]">{v.name}</p>
                  <p className="shrink-0 text-[14px] font-medium tabular-nums tracking-[-0.02em]">
                    {v.unit != null ? formatPrice(v.unit * l.qty, store.currency) : ""}
                  </p>
                </div>
                {v.desc && <p className="text-[12px] leading-4 text-ink-3">{v.desc}</p>}
                {!v.ok && <p className="text-[12px] font-medium text-danger">Plus disponible : retirez-le pour commander.</p>}
                {editable ? (
                  <button type="button" onClick={() => setEditing(l.key)} className="shop-qty" aria-label={`Quantité ${l.qty}, modifier`}>
                    Qté {l.qty} <ChevronDown size={10} />
                  </button>
                ) : (
                  <p className="mt-0.5 text-[12px] text-ink-3">Qté {l.qty}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {line && (
        <QtyPicker
          name={view(line, lines.indexOf(line)).name}
          image={view(line, lines.indexOf(line)).image}
          qty={line.qty}
          onClose={() => setEditing(null)}
          onSave={(n) => {
            setQty(line.key, n);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function Amount({ value, loading, muted }: { value: string; loading: boolean; muted?: boolean }) {
  return (
    <span className={`shrink-0 tabular-nums tracking-[-0.02em] ${muted ? "font-normal text-ink-3" : "font-semibold"} ${loading ? "shop-amt-skel" : ""}`}>
      {value}
    </span>
  );
}

export function Totals({ totalLabel = "Total" }: { totalLabel?: string }) {
  const { quote, store, promo, setPromo, shipping } = useCart();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const money = (n: number) => formatPrice(n, store.currency);
  const loading = !quote;
  const q = quote;
  return (
    <div className="ps-[58px] text-[14px]">
      <div className="h-px bg-black/10" />
      <div className="flex justify-between py-4">
        <span className="font-medium">Sous-total</span>
        <Amount value={q ? money(q.subtotal) : "000,00 MAD"} loading={loading} />
      </div>

      {promo && !q?.promo_error ? (
        <div className="flex items-start justify-between pb-4">
          <span className="inline-flex items-center rounded-md bg-black/10 px-3 py-2 text-[14px] font-medium">
            {promo}
            <button type="button" onClick={() => setPromo(null)} aria-label={`Retirer le code ${promo}`} className="ms-1.5 p-0.5">
              <CloseIcon size={12} />
            </button>
          </span>
          {q && q.discount > 0 && <span className="pt-2 tabular-nums text-ink-3">-{money(q.discount)}</span>}
        </div>
      ) : editing ? (
        <form
          className="pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) setPromo(code);
            setEditing(false);
          }}
        >
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onBlur={() => {
              if (code.trim()) setPromo(code);
              setEditing(false);
            }}
            placeholder="Code promo"
            aria-label="Code promo"
            className="ui-input h-9 text-[14px]"
          />
        </form>
      ) : (
        <div className="pb-4">
          <button type="button" onClick={() => setEditing(true)} className="h-9 rounded-md bg-soft px-3 text-[14px] font-medium hover:bg-black/10">
            Ajouter un code promo
          </button>
          {promo && q?.promo_error && (
            <p className="mt-1.5 text-[13px] text-danger">
              {promo} : {PROMO_ERRORS[q.promo_error]}{" "}
              <button type="button" onClick={() => setPromo(null)} className="underline underline-offset-2">
                Retirer
              </button>
            </p>
          )}
        </div>
      )}

      {shipping.length > 0 && (
        <div className="flex justify-between pb-4">
          <span>
            Livraison
            {q?.shipping && <span className="block text-[12px] text-ink-3">{q.shipping.name}</span>}
          </span>
          <Amount value={q?.shipping ? (q.shipping.fee ? money(q.shipping.fee) : "Gratuite") : "00,00 MAD"} loading={loading} muted />
        </div>
      )}
      <div className="h-px bg-black/10" />
      <div className="flex justify-between pt-4 text-[16px]">
        <span className="font-medium">{totalLabel}</span>
        <Amount value={q ? money(q.total) : "000,00 MAD"} loading={loading} />
      </div>
    </div>
  );
}

// "Encore 120 MAD pour la livraison gratuite", with a bar that fills up.
export function FreeShippingBar() {
  const { quote, shipping, store } = useCart();
  const threshold = freeFrom(shipping);
  if (threshold == null || !quote) return null;
  const after = quote.subtotal - quote.discount;
  const left = threshold - after;
  return (
    <div className="text-[13px] text-ink-2">
      <div className="h-[3px] overflow-hidden rounded-full bg-black/10">
        <div className="h-full bg-ink/60 transition-[width] duration-500" style={{ width: `${Math.min(100, (after / threshold) * 100)}%` }} />
      </div>
      <p className="mt-1.5">
        {left > 0 ? (
          <>
            Encore <b className="font-semibold">{formatPrice(left, store.currency)}</b> pour la livraison gratuite.
          </>
        ) : (
          "La livraison standard est offerte."
        )}
      </p>
    </div>
  );
}
