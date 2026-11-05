"use client";

// Tap a card: it grows into this sheet over the lower part of the video. Recording keeps
// running, and voice commands apply to the open product. Close: it shrinks back to its card.
// The AI fills name and description on its own (the merchant edits what they do not like);
// the suggested price waits for one tap.

import { useLayoutEffect, useRef, useState } from "react";
import { cover, displayName, suggestedPrice, type PriceCheck, type Product } from "@/lib/capture/session";
import { formatPrice } from "./ProductCard";

type Props = {
  p: Product;
  from: DOMRect;
  attaching: boolean;
  onClose: () => void;
  onEdit: (patch: Partial<Product>) => void;
  onRemoveImage: (imageId: string) => void;
  onView: (index: number) => void; // full-screen preview with the quality score
  onAttach: () => void;
  onBetterPhotos: () => void;
  onCheckPrice: () => void;
  onRemove: () => void;
  onPublish: (online: boolean) => void; // drafts until the merchant puts them online
};

const DURATION = 320;

function flipFrom(el: HTMLElement, from: DOMRect) {
  const to = el.getBoundingClientRect();
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

export default function ProductSheet(props: Props) {
  const { p, from, attaching, onClose, onEdit } = props;
  const sheetRef = useRef<HTMLDivElement>(null);
  const suggested = p.price == null ? suggestedPrice(p) : null;
  const researching = p.research === "running" || p.identify === "loading";
  const img = cover(p);

  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.animate([{ transform: flipFrom(el, from), opacity: 0.4 }, { transform: "none", opacity: 1 }], {
      duration: DURATION,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  }, [from]);

  const close = () => {
    const el = sheetRef.current;
    if (!el) return onClose();
    const a = el.animate([{ transform: "none", opacity: 1 }, { transform: flipFrom(el, from), opacity: 0.2 }], {
      duration: DURATION * 0.8,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    });
    a.onfinish = onClose;
  };

  const commitNumber = (raw: string, key: "price" | "quantity") => {
    const v = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (v === null || Number.isFinite(v)) {
      if (v !== p[key]) onEdit(key === "price" ? { price: v, compareAtPrice: null } : { quantity: v });
    }
  };

  return (
    <div
      ref={sheetRef}
      className="absolute inset-x-0 bottom-0 z-20 mx-auto flex max-h-[80dvh] max-w-lg origin-top-left flex-col overflow-hidden rounded-t-2xl bg-white text-ink shadow-[0_-12px_40px_rgba(0,0,0,0.25)] sm:bottom-3 sm:rounded-2xl"
      role="dialog"
      aria-label={displayName(p)}
    >
      {/* header */}
      <div className="flex items-center gap-3 border-b border-black/10 px-4 py-3">
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img.url} alt="" className="h-10 w-10 shrink-0 rounded object-contain ring-1 ring-black/10" />
        )}
        <div className="min-w-0 flex-1">
          <p dir="auto" className="truncate text-base font-medium">
            {displayName(p)}
          </p>
          <p className="truncate text-xs text-ink-3">
            {researching ? "Recherche en cours…" : [p.category, p.nameAr].filter(Boolean).join(" · ") || " "}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Fermer"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-soft active:scale-90"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2 2l8 8m0-8l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="overflow-y-auto px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* photos */}
        <div className="no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
          {p.images.map((im, i) => (
            <div key={im.id} className="relative w-[84px] shrink-0 snap-start">
              <button
                type="button"
                onClick={() => props.onView(i)}
                aria-label={i === 0 ? "Voir la photo principale" : "Voir la photo"}
                className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-white ${
                  i === 0 ? "ring-2 ring-ink" : "ring-1 ring-black/10"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.url} alt="" className={`h-full w-full object-contain ${im.pending ? "opacity-60" : ""}`} />
                {im.pending && <span className="shimmer absolute inset-0" />}
              </button>
              {im.source !== "camera" && (
                <span className="ui-badge absolute start-1 bottom-1 max-w-[76px] truncate">
                  {im.source === "studio" ? "Studio" : im.source === "ai" ? `IA${im.credit ? ` · ${im.credit}` : ""}` : (im.credit ?? "Web")}
                </span>
              )}
              <button
                type="button"
                onClick={() => props.onRemoveImage(im.id)}
                aria-label="Retirer cette photo"
                className="absolute end-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-ink-2 shadow ring-1 ring-black/10"
              >
                <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden>
                  <path d="M1.5 1.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
          {p.photos === "loading" && [0, 1].map((i) => <div key={i} className="ui-skel aspect-square w-[84px] shrink-0 animate-pulse" />)}
          <button
            type="button"
            onClick={props.onAttach}
            aria-label="Ajouter une photo"
            className={`flex aspect-square w-[84px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md text-xs font-medium ${
              attaching ? "bg-brand text-white" : "bg-soft text-ink-2"
            }`}
          >
            <span className="text-xl leading-none">+</span>
            Photo
          </button>
        </div>

        {/* name */}
        <div className="mt-4">
          <label className="ui-label" htmlFor="sheet-name">
            Nom
          </label>
          <input
            id="sheet-name"
            key={`name-${p.id}-${p.name}`}
            dir="auto"
            defaultValue={p.name ?? ""}
            placeholder="Nom du produit"
            onBlur={(e) => e.target.value.trim() !== (p.name ?? "") && onEdit({ name: e.target.value.trim() || null })}
            className="ui-input"
          />
          <BarcodeLine key={`bc-${p.id}-${p.barcode}`} code={p.barcode} onSave={(barcode) => onEdit({ barcode })} />
        </div>

        {/* price and stock */}
        <div className="mt-4 flex gap-3">
          <div className="min-w-0 flex-1">
            <label className="ui-label" htmlFor="sheet-price">
              Prix ({p.currency === "EUR" ? "€" : "DH"})
            </label>
            <input
              id="sheet-price"
              key={`price-${p.id}-${p.price}`}
              inputMode="decimal"
              defaultValue={p.price ?? ""}
              placeholder="0"
              onBlur={(e) => commitNumber(e.target.value, "price")}
              className="ui-input tabular-nums"
            />
          </div>
          <div className="w-24">
            <label className="ui-label" htmlFor="sheet-qty">
              Stock
            </label>
            <input
              id="sheet-qty"
              key={`qty-${p.id}-${p.quantity}`}
              inputMode="numeric"
              defaultValue={p.quantity ?? ""}
              placeholder="0"
              onBlur={(e) => commitNumber(e.target.value, "quantity")}
              className="ui-input tabular-nums"
            />
          </div>
        </div>
        {p.compareAtPrice != null && (
          <p className="mt-1.5 text-[13px] text-ink-3">
            Avant remise : <span className="line-through tabular-nums">{formatPrice(p.compareAtPrice, p.currency)}</span>
          </p>
        )}
        {suggested != null && (
          <Proposal
            text={`Conseillé : ${formatPrice(suggested, p.currency)}`}
            onUse={() => onEdit({ price: suggested, compareAtPrice: null })}
          />
        )}
        {p.priceCheck && <PriceDetails check={p.priceCheck} price={p.price} currency={p.currency} />}

        {/* description */}
        <div className="mt-4">
          <label className="ui-label" htmlFor="sheet-desc">
            Description
          </label>
          <textarea
            id="sheet-desc"
            key={`desc-${p.id}-${p.description}`}
            dir="auto"
            rows={3}
            defaultValue={p.description ?? ""}
            placeholder="Écrivez, ou dites « la description : … »"
            onBlur={(e) =>
              e.target.value.trim() !== (p.description ?? "") && onEdit({ description: e.target.value.trim() || null })
            }
            className="ui-input h-auto resize-none py-2.5 leading-snug"
          />
        </div>

        {/* actions */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={props.onBetterPhotos}
            disabled={p.photos === "loading" || !p.images.length}
            className="ui-btn ui-btn-soft h-11"
          >
            {p.photos === "loading" ? "Photos en cours…" : "Chercher des photos"}
          </button>
          <button
            type="button"
            onClick={props.onCheckPrice}
            disabled={p.priceCheck?.status === "loading"}
            className="ui-btn ui-btn-soft h-11"
          >
            {p.priceCheck?.status === "loading" ? "Recherche…" : "Vérifier le prix"}
          </button>
        </div>
        {p.photos === "error" && <p className="mt-2 text-[13px] text-danger">Les photos n’ont pas pu être créées.</p>}
        {p.photos === "refused" && <p className="mt-2 text-[13px] text-ink-2">L’IA ne crée pas de photo pour ce type de produit. Rien n’a été facturé, vos photos restent.</p>}

        <button
          type="button"
          onClick={() => props.onPublish(!p.online)}
          className={`ui-btn mt-4 h-11 w-full ${p.online ? "ui-btn-secondary" : "ui-btn-primary"}`}
        >
          {p.online ? "Retirer de la boutique" : "Mettre en ligne"}
        </button>
        <p className="mt-1.5 text-center text-xs text-ink-3">
          {p.online ? "En ligne dans votre boutique." : "Brouillon : enregistré, pas encore visible."}
        </p>

        <div className="mt-2 flex justify-center">
          <button type="button" onClick={props.onRemove} className="ui-btn h-9 text-[13px] text-danger hover:bg-soft">
            Supprimer ce produit
          </button>
        </div>
      </div>
    </div>
  );
}

// The barcode stays out of the way: a small line under the name when one was read, or a
// small "+ Code-barres" button. Tapping opens the field; showing the barcode to the camera
// while the sheet is open fills it too.
function BarcodeLine({ code, onSave }: { code: string | null; onSave: (code: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const save = (v: string) => {
    const c = v.replace(/s+/g, "");
    if (c !== (code ?? "")) onSave(c || null);
    setEditing(false);
  };
  if (editing) {
    return (
      <div className="mt-2">
        <div className="flex gap-2">
          <input
            autoFocus
            inputMode="numeric"
            defaultValue={code ?? ""}
            placeholder="Code-barres"
            onBlur={(e) => save(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save((e.target as HTMLInputElement).value)}
            className="ui-input h-10 font-mono tracking-wider"
            aria-label="Code-barres"
          />
        </div>
        <p className="mt-1 text-xs text-ink-3">Ou montrez le code-barres à la caméra.</p>
      </div>
    );
  }
  return code ? (
    <div className="mt-1.5 flex items-center gap-2 text-[13px] text-ink-3">
      <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden className="shrink-0 text-ink-2">
        <path d="M1 0v12M3 0v12M4.5 0v12M7 0v12M9 0v12M10 0v12M12.5 0v12M15 0v12" stroke="currentColor" strokeWidth="1" />
      </svg>
      <span className="font-mono tracking-wider text-ink-2">{code}</span>
      <button type="button" onClick={() => setEditing(true)} className="ms-auto font-medium text-brand">
        Modifier
      </button>
    </div>
  ) : (
    <button type="button" onClick={() => setEditing(true)} className="mt-1.5 text-[13px] font-medium text-brand">
      + Code-barres
    </button>
  );
}

// The suggested price under the empty price field, with a one-tap "Utiliser".
function Proposal({ text, onUse }: { text: string; onUse: () => void }) {
  return (
    <div className="mt-1.5 flex items-start gap-2 text-[13px] leading-snug">
      <span dir="auto" className="line-clamp-2 min-w-0 flex-1 text-ink-3">
        {text}
      </span>
      <button type="button" onClick={onUse} className="shrink-0 font-medium text-brand">
        Utiliser
      </button>
    </div>
  );
}

const VERDICT: Record<string, { text: string; className: string }> = {
  cheap: { text: "Moins cher que le marché", className: "text-ok" },
  fair: { text: "Dans le prix du marché", className: "text-ink-2" },
  expensive: { text: "Plus cher que le marché", className: "text-danger" },
  unknown: { text: "", className: "" },
};

// The market range in one line; the four prices, note and sources open on demand.
function PriceDetails({ check, price, currency }: { check: PriceCheck; price: number | null; currency: string }) {
  const [open, setOpen] = useState(false);
  if (check.status === "loading") {
    return (
      <div className="mt-3 flex items-center gap-2 text-[13px] text-ink-3">
        <span className="ui-skel h-3 w-40 animate-pulse" /> Prix au Maroc…
      </div>
    );
  }
  if (check.status === "error") return <p className="mt-3 text-[13px] text-danger">{check.message}</p>;

  const { low, average, high, suggested } = check;
  const cur = check.currency || currency;
  const fmt = (v: number | null) => (v == null ? "—" : formatPrice(Math.round(v * 100) / 100, cur));
  const values = [low, high, suggested, price].filter((v): v is number => v != null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pos = (v: number) => (max > min ? ((v - min) / (max - min)) * 100 : 50);
  const verdict = price != null ? VERDICT[check.verdict] : null;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="text-ink-3">Marché au Maroc</span>
        <span className="font-medium tabular-nums">
          {fmt(low)} – {fmt(high)}
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ms-auto font-medium text-brand">
          {open ? "Masquer" : "Détails"}
        </button>
      </div>
      {verdict?.text && <p className={`mt-0.5 text-[13px] font-medium ${verdict.className}`}>{verdict.text}</p>}

      {open && (
        <div className="ui-card mt-2 p-3">
          <div className="grid grid-cols-4 text-center">
            {(
              [
                ["Plus bas", low],
                ["Moyenne", average],
                ["Conseillé", suggested],
                ["Plus haut", high],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <p className="text-[11px] text-ink-3">{k}</p>
                <p className="text-sm font-semibold tabular-nums">{fmt(v)}</p>
              </div>
            ))}
          </div>
          {values.length > 1 && (
            <div className="relative mx-1 mt-3 h-1.5 rounded-full bg-black/10">
              {suggested != null && (
                <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-brand" style={{ left: `${pos(suggested)}%` }} title="Conseillé" />
              )}
              {price != null && (
                <span
                  className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ink shadow"
                  style={{ left: `${pos(price)}%` }}
                  title="Votre prix"
                />
              )}
            </div>
          )}
          {check.note && (
            <p dir="auto" className="mt-3 text-[13px] leading-snug text-ink-2">
              {check.note}
            </p>
          )}
          {check.sources.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-t border-black/10 pt-2">
              {check.sources.slice(0, 5).map((s) => (
                <li key={s.url + s.title} className="flex gap-2 text-xs">
                  <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-brand">
                    {s.title}
                  </a>
                  {s.price != null && <span className="tabular-nums text-ink-2">{fmt(s.price)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
