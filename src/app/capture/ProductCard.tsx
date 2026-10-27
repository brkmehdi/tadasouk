"use client";

import { cover, displayName, type Product } from "@/lib/capture/session";

type Props = {
  p: Product;
  current: boolean;
  attaching: boolean;
  onOpen: (id: string, from: DOMRect) => void;
  onRemove: (id: string) => void;
  onAttach: (id: string) => void;
};

export default function ProductCard({ p, current, attaching, onOpen, onRemove, onAttach }: Props) {
  const img = cover(p);
  return (
    <div
      className={`card-in relative shrink-0 rounded-2xl bg-white/10 p-1.5 backdrop-blur-md transition-all ${
        attaching ? "ring-2 ring-sky-400" : current ? "ring-2 ring-amber-300" : ""
      } ${p.status === "removing" ? "card-out" : ""}`}
    >
      <button
        type="button"
        onClick={(e) => onOpen(p.id, e.currentTarget.getBoundingClientRect())}
        className="block w-full text-start"
        aria-label={`Ouvrir ${displayName(p)}`}
      >
        <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-white/5">
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img.url}
              alt={displayName(p)}
              className={`max-h-full max-w-full object-contain transition-all duration-500 ${
                img.pending ? "opacity-60 blur-[1px]" : "drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
              }`}
            />
          )}
          {(img?.pending || p.photos === "loading") && <div className="shimmer absolute inset-0" />}
          {p.question && (
            <span className="absolute start-1 bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-black">
              ?
            </span>
          )}
          {p.images.length > 1 && (
            <span className="absolute start-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] leading-4">
              {p.images.length}
            </span>
          )}
        </div>
        {p.name && (
          <p dir="auto" className="mt-1 truncate text-xs text-neutral-200">
            {p.name}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
          {p.price == null ? (
            <span className="shimmer block h-5 w-16 rounded-md" />
          ) : (
            <>
              <PriceChip value={p.price} currency={p.currency} />
              {p.compareAtPrice != null && (
                <span className="text-xs text-neutral-400 line-through">{formatPrice(p.compareAtPrice, p.currency)}</span>
              )}
            </>
          )}
          {p.quantity != null && <span className="text-[10px] text-neutral-400">×{p.quantity}</span>}
        </div>
      </button>

      {/* delete */}
      <button
        type="button"
        onClick={() => onRemove(p.id)}
        aria-label={`Supprimer ${displayName(p)}`}
        className="absolute -end-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-sm text-white ring-1 ring-white/30 active:scale-90"
      >
        ✕
      </button>
      {/* add photos to this product */}
      <button
        type="button"
        onClick={() => onAttach(p.id)}
        aria-label={`Ajouter des photos à ${displayName(p)}`}
        className={`absolute -end-1 bottom-9 flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none ring-1 active:scale-90 ${
          attaching ? "bg-sky-400 text-black ring-sky-200" : "bg-black/70 text-white ring-white/30"
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
      className="type-in rounded-md bg-amber-300 px-1.5 py-0.5 font-mono text-sm font-bold text-black"
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
