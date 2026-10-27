"use client";

import { useEffect, useRef } from "react";
import { cover, displayName, suggestedPrice, type Product } from "@/lib/capture/session";

type Props = {
  p: Product;
  current: boolean;
  attaching: boolean;
  flash: number; // changes when the camera shows this product again
  onOpen: (id: string, from: DOMRect) => void;
  onRemove: (id: string) => void;
  onAttach: (id: string) => void;
};

export default function ProductCard({ p, current, attaching, flash, onOpen, onRemove, onAttach }: Props) {
  const img = cover(p);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flash) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [flash]);
  const suggested = suggestedPrice(p);
  return (
    <div
      ref={ref}
      data-card={p.id}
      className={`card-pop relative shrink-0 rounded-2xl bg-white/10 p-1.5 backdrop-blur-md transition-all ${
        attaching ? "ring-2 ring-sky-400" : current ? "ring-2 ring-amber-300" : ""
      } ${p.status === "removing" ? "card-out" : ""}`}
    >
      <button
        type="button"
        onClick={(e) => onOpen(p.id, e.currentTarget.getBoundingClientRect())}
        className="block w-full text-start"
        aria-label={`Ouvrir ${displayName(p)}`}
      >
        <div className="relative aspect-square overflow-hidden rounded-xl bg-white">
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img.url}
              alt={displayName(p)}
              className={`h-full w-full object-contain transition-all duration-500 ${img.pending ? "opacity-70 blur-[1px]" : ""}`}
            />
          )}
          {(img?.pending || p.photos === "loading") && <div className="shimmer absolute inset-0" />}
          {p.research === "running" && (
            <span className="absolute start-1 top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400 ring-2 ring-white" aria-label="Recherche en cours" />
          )}
          {p.images.length > 1 && (
            <span className="absolute start-1 bottom-1 rounded-full bg-black/60 px-1.5 text-[10px] leading-4 text-white">
              {p.images.length}
            </span>
          )}
          {p.question && (
            <span className="absolute inset-x-0 bottom-1 mx-auto flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-black">
              ?
            </span>
          )}
        </div>

        {/* name: one fixed line, never pushes the card taller */}
        <p dir="auto" className="mt-1 h-3.5 truncate text-[11px] leading-[14px] text-neutral-100">
          {p.name ?? (p.identify === "loading" ? <span className="shimmer inline-block h-2.5 w-14 rounded" /> : <span className="text-neutral-400 italic">Sans nom</span>)}
        </p>

        {/* price: one fixed line */}
        <div className="mt-0.5 flex h-5 items-center gap-1 overflow-hidden whitespace-nowrap">
          {p.price != null ? (
            <>
              <PriceChip value={p.price} currency={p.currency} />
              {p.compareAtPrice != null && (
                <span className="text-[10px] text-neutral-400 line-through">{formatPrice(p.compareAtPrice, p.currency)}</span>
              )}
            </>
          ) : suggested != null ? (
            <span className="rounded-md border border-dashed border-amber-300/80 px-1 font-mono text-[11px] text-amber-200">
              ≈ {formatPrice(suggested, p.currency)}
            </span>
          ) : (
            <span className="shimmer block h-4 w-14 rounded-md" />
          )}
        </div>
      </button>

      {flash > 0 && <span key={flash} className="card-flash pointer-events-none absolute inset-0 rounded-2xl" />}
      {/* delete */}
      <button
        type="button"
        onClick={() => onRemove(p.id)}
        aria-label={`Supprimer ${displayName(p)}`}
        className="absolute -end-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-xs text-white ring-1 ring-white/30 active:scale-90"
      >
        ✕
      </button>
      {/* add photos to this product */}
      <button
        type="button"
        onClick={() => onAttach(p.id)}
        aria-label={`Ajouter des photos à ${displayName(p)}`}
        className={`absolute end-2.5 bottom-[3.25rem] flex h-6 w-6 items-center justify-center rounded-full text-base leading-none ring-1 active:scale-90 ${
          attaching ? "bg-sky-400 text-black ring-sky-200" : "bg-black/75 text-white ring-white/30"
        }`}
      >
        +
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
      className="type-in rounded-md bg-amber-300 px-1 font-mono text-xs leading-5 font-bold text-black"
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
