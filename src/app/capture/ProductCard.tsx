"use client";

import { useEffect, useRef } from "react";
import { cover, displayName, suggestedPrice, type Product } from "@/lib/capture/session";

type Props = {
  p: Product;
  current: boolean;
  flash: number; // changes when the camera shows this product again
  attaching: boolean; // the next photo goes to this product
  onOpen: (id: string, from: DOMRect) => void;
  onRemove: (id: string) => void; // asks for confirmation first
  onAttach: (id: string) => void;
};

// Frosted card in the tray over the video. Two fixed lines under the photo (name, price)
// so a long name never pushes the card taller.
export default function ProductCard({ p, current, flash, attaching, onOpen, onRemove, onAttach }: Props) {
  const img = cover(p);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flash) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [flash]);
  const suggested = suggestedPrice(p);
  const busy = p.research === "running" || p.identify === "loading";

  return (
    <div
      ref={ref}
      data-card={p.id}
      className={`card-pop relative shrink-0 rounded-xl bg-white/15 p-1.5 shadow-lg ring-1 backdrop-blur-xl transition-all ${
        attaching ? "ring-2 ring-brand" : current ? "ring-2 ring-white" : "ring-white/20"
      } ${p.status === "removing" ? "card-out" : ""}`}
    >
      <button
        type="button"
        onClick={(e) => onOpen(p.id, e.currentTarget.getBoundingClientRect())}
        className="block w-full text-start"
        aria-label={`Ouvrir ${displayName(p)}`}
      >
        <div className="relative aspect-square overflow-hidden rounded-lg bg-white">
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img.url}
              alt={displayName(p)}
              className={`h-full w-full object-contain transition-all duration-500 ${img.pending ? "opacity-70 blur-[1px]" : ""}`}
            />
          )}
          {(img?.pending || p.photos === "loading") && <div className="shimmer absolute inset-0" />}
          {busy && <span className="absolute start-1.5 top-1.5 h-2 w-2 animate-pulse rounded-full bg-brand" aria-label="Recherche en cours" />}
          {p.online && (
            <span className="absolute end-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-ok ring-2 ring-white" aria-label="En ligne" />
          )}
          {p.images.length > 1 && (
            <span className="absolute start-1 bottom-1 rounded bg-black/55 px-1 text-[10px] leading-4 text-white tabular-nums">
              {p.images.length}
            </span>
          )}
          {p.question && (
            <span className="absolute end-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold text-ink shadow">
              ?
            </span>
          )}
        </div>

        <p dir="auto" className="mt-1.5 h-3.5 truncate px-0.5 text-[11px] leading-[14px] font-medium text-white">
          {p.name ? (
            displayName(p)
          ) : busy ? (
            <span className="shimmer inline-block h-2.5 w-14 rounded" />
          ) : (
            <span className="text-white/60">Sans nom</span>
          )}
        </p>

        <div className="mt-1 flex h-5 items-center gap-1 overflow-hidden px-0.5 whitespace-nowrap">
          {p.price != null ? (
            <>
              <PriceChip value={p.price} currency={p.currency} />
              {p.compareAtPrice != null && (
                <span className="text-[10px] text-white/60 line-through tabular-nums">{formatPrice(p.compareAtPrice, p.currency)}</span>
              )}
            </>
          ) : suggested != null ? (
            <span className="rounded border border-dashed border-white/70 px-1 text-[11px] leading-4 text-white tabular-nums">
              ≈ {formatPrice(suggested, p.currency)}
            </span>
          ) : busy ? (
            <span className="shimmer block h-4 w-14 rounded" />
          ) : (
            <span className="text-[11px] text-white/60">Prix ?</span>
          )}
        </div>
      </button>

      {flash > 0 && <span key={flash} className="card-flash pointer-events-none absolute inset-0 rounded-xl" />}
      {/* add another photo of this product */}
      <button
        type="button"
        onClick={() => onAttach(p.id)}
        aria-label={`Ajouter une photo à ${displayName(p)}`}
        aria-pressed={attaching}
        className={`absolute end-2.5 bottom-[3.4rem] flex h-7 w-7 items-center justify-center rounded-full ring-1 shadow active:scale-90 ${
          attaching ? "armed-pulse bg-brand text-white ring-white" : "bg-white text-ink ring-black/10"
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onRemove(p.id)}
        aria-label={`Supprimer ${displayName(p)}`}
        className="absolute -end-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/30 backdrop-blur active:scale-90"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1.5 1.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// The price types itself in, one character at a time.
export function PriceChip({ value, currency }: { value: number; currency: string }) {
  const text = formatPrice(value, currency);
  return (
    <span
      key={text}
      className="type-in rounded bg-white px-1 text-xs leading-5 font-semibold text-ink tabular-nums"
      style={{ "--chars": text.length } as React.CSSProperties}
    >
      {text}
    </span>
  );
}

export function formatPrice(v: number, currency: string) {
  const n = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return currency === "EUR" ? `${n} €` : `${n} DH`;
}
