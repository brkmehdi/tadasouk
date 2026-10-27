"use client";

// Tap a card: it grows into this sheet over the lower part of the video. Recording keeps
// running, and voice commands apply to the open product. Close: it shrinks back to its card.

import { useLayoutEffect, useRef } from "react";
import { displayName, type PriceCheck, type Product } from "@/lib/capture/session";
import { formatPrice } from "./ProductCard";

type Props = {
  p: Product;
  from: DOMRect;
  attaching: boolean;
  onClose: () => void;
  onEdit: (patch: Partial<Product>) => void;
  onRemoveImage: (imageId: string) => void;
  onCover: (imageId: string) => void;
  onAttach: () => void;
  onBetterPhotos: () => void;
  onCheckPrice: () => void;
};

const DURATION = 320;

function flipFrom(el: HTMLElement, from: DOMRect) {
  const to = el.getBoundingClientRect();
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

export default function ProductSheet(props: Props) {
  const { p, from, attaching, onClose, onEdit } = props;
  const sheetRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.animate([{ transform: flipFrom(el, from), opacity: 0.4, borderRadius: "16px" }, { transform: "none", opacity: 1 }], {
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
      className="absolute inset-x-2 bottom-2 z-20 flex max-h-[68dvh] origin-top-left flex-col overflow-hidden rounded-3xl bg-neutral-900/95 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
      role="dialog"
      aria-label={displayName(p)}
    >
      <div className="flex items-center gap-2 px-4 pt-3">
        <input
          key={`name-${p.id}-${p.name}`}
          dir="auto"
          defaultValue={p.name ?? ""}
          placeholder={displayName(p)}
          onBlur={(e) => e.target.value.trim() !== (p.name ?? "") && onEdit({ name: e.target.value.trim() || null })}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-neutral-500"
          aria-label="Nom du produit"
        />
        <button
          type="button"
          onClick={close}
          aria-label="Fermer"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg active:scale-90"
        >
          ✕
        </button>
      </div>

      <div className="overflow-y-auto px-4 pb-4">
        {/* photos */}
        <div className="-mx-4 mt-3 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
          {p.images.map((img, i) => (
            <div key={img.id} className="relative w-32 shrink-0 snap-start">
              <button
                type="button"
                onClick={() => props.onCover(img.id)}
                aria-label={i === 0 ? "Photo principale" : "Mettre en photo principale"}
                className={`flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl ${
                  img.source === "ai" ? "bg-neutral-100" : "bg-white/5"
                } ${i === 0 ? "ring-2 ring-amber-300" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className={`max-h-full max-w-full object-contain ${img.pending ? "opacity-60" : ""}`} />
                {img.pending && <span className="shimmer absolute inset-0 rounded-2xl" />}
              </button>
              {img.source === "ai" && (
                <span className="absolute start-1.5 bottom-1.5 rounded-full bg-black/70 px-1.5 text-[10px]">IA</span>
              )}
              <button
                type="button"
                onClick={() => props.onRemoveImage(img.id)}
                aria-label="Retirer cette photo"
                className="absolute end-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs"
              >
                ✕
              </button>
            </div>
          ))}
          {p.photos === "loading" &&
            [0, 1].map((i) => <div key={i} className="shimmer aspect-square w-32 shrink-0 rounded-2xl" />)}
          <button
            type="button"
            onClick={props.onAttach}
            className={`flex aspect-square w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed text-xs ${
              attaching ? "border-sky-400 bg-sky-400/15 text-sky-200" : "border-white/25 text-neutral-300"
            }`}
          >
            <span className="text-2xl leading-none">+</span>
            {attaching ? "Filmez-le" : "Photo"}
          </button>
        </div>

        {/* price and stock */}
        <div className="mt-3 flex items-end gap-3">
          <label className="flex-1">
            <span className="text-xs text-neutral-400">Prix ({p.currency === "EUR" ? "€" : "DH"})</span>
            <input
              key={`price-${p.id}-${p.price}`}
              inputMode="decimal"
              defaultValue={p.price ?? ""}
              placeholder="—"
              onBlur={(e) => commitNumber(e.target.value, "price")}
              className="mt-0.5 w-full rounded-xl bg-white/10 px-3 py-2 font-mono text-lg outline-none focus:ring-2 focus:ring-amber-300"
            />
          </label>
          {p.compareAtPrice != null && (
            <span className="pb-2.5 text-sm text-neutral-400 line-through">{formatPrice(p.compareAtPrice, p.currency)}</span>
          )}
          <label className="w-20">
            <span className="text-xs text-neutral-400">Stock</span>
            <input
              key={`qty-${p.id}-${p.quantity}`}
              inputMode="numeric"
              defaultValue={p.quantity ?? ""}
              placeholder="—"
              onBlur={(e) => commitNumber(e.target.value, "quantity")}
              className="mt-0.5 w-full rounded-xl bg-white/10 px-3 py-2 font-mono text-lg outline-none focus:ring-2 focus:ring-amber-300"
            />
          </label>
        </div>

        {/* description */}
        <label className="mt-3 block">
          <span className="text-xs text-neutral-400">Description</span>
          <textarea
            key={`desc-${p.id}-${p.description}`}
            dir="auto"
            rows={3}
            defaultValue={p.description ?? ""}
            placeholder="Écrivez, ou dites : « la description : … »"
            onBlur={(e) =>
              e.target.value.trim() !== (p.description ?? "") && onEdit({ description: e.target.value.trim() || null })
            }
            className="mt-0.5 w-full resize-none rounded-xl bg-white/10 px-3 py-2 text-[15px] leading-snug outline-none placeholder:text-neutral-500 focus:ring-2 focus:ring-amber-300"
          />
        </label>

        {/* actions */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={props.onBetterPhotos}
            disabled={p.photos === "loading" || !p.images.length}
            className="rounded-2xl bg-white/10 px-3 py-3 text-sm font-medium active:scale-[0.98] disabled:opacity-40"
          >
            {p.photos === "loading" ? "Photos en cours…" : "✨ Meilleures photos"}
          </button>
          <button
            type="button"
            onClick={props.onCheckPrice}
            disabled={p.priceCheck?.status === "loading"}
            className="rounded-2xl bg-white/10 px-3 py-3 text-sm font-medium active:scale-[0.98] disabled:opacity-40"
          >
            {p.priceCheck?.status === "loading" ? "Recherche…" : "📊 Vérifier le prix"}
          </button>
        </div>
        {p.photos === "error" && <p className="mt-2 text-sm text-red-300">Les photos n&apos;ont pas pu être créées.</p>}

        {p.priceCheck && <PriceCheckView check={p.priceCheck} price={p.price} currency={p.currency} />}
      </div>
    </div>
  );
}

const VERDICT: Record<string, { text: string; className: string }> = {
  cheap: { text: "Moins cher que le marché", className: "bg-emerald-400 text-black" },
  fair: { text: "Prix dans le marché", className: "bg-sky-400 text-black" },
  expensive: { text: "Plus cher que le marché", className: "bg-rose-400 text-black" },
  unknown: { text: "Pas assez de prix trouvés", className: "bg-white/20" },
};

function PriceCheckView({ check, price, currency }: { check: PriceCheck; price: number | null; currency: string }) {
  if (check.status === "loading") {
    return (
      <div className="mt-3 rounded-2xl bg-white/5 p-3">
        <p className="text-sm text-neutral-300">Recherche des prix au Maroc…</p>
        <div className="shimmer mt-2 h-3 rounded-full" />
      </div>
    );
  }
  if (check.status === "error") {
    return <p className="mt-3 text-sm text-red-300">{check.message}</p>;
  }
  const { low, average, high } = check;
  const values = [low, average, high, price].filter((v): v is number => v != null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pos = (v: number) => (max > min ? ((v - min) / (max - min)) * 100 : 50);
  const verdict = VERDICT[check.verdict] ?? VERDICT.unknown;
  const fmt = (v: number | null) => (v == null ? "—" : formatPrice(Math.round(v * 100) / 100, check.currency || currency));

  return (
    <div className="mt-3 rounded-2xl bg-white/5 p-3">
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${verdict.className}`}>{verdict.text}</span>
      <div className="mt-3 grid grid-cols-3 text-center">
        {(
          [
            ["Le plus bas", low],
            ["Moyenne", average],
            ["Le plus haut", high],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <p className="text-[11px] text-neutral-400">{k}</p>
            <p className="font-mono text-sm font-semibold">{fmt(v)}</p>
          </div>
        ))}
      </div>
      {values.length > 1 && (
        <div className="relative mx-1 mt-3 h-2 rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-rose-400">
          {average != null && (
            <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-white/80" style={{ left: `${pos(average)}%` }} />
          )}
          {price != null && (
            <span
              className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black bg-amber-300"
              style={{ left: `${pos(price)}%` }}
              title="Votre prix"
            />
          )}
        </div>
      )}
      {check.note && (
        <p dir="auto" className="mt-3 text-sm leading-snug text-neutral-300">
          {check.note}
        </p>
      )}
      {check.sources.length > 0 && (
        <ul className="mt-2 space-y-1">
          {check.sources.slice(0, 5).map((s) => (
            <li key={s.url + s.title} className="flex gap-2 text-xs">
              <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sky-300 underline">
                {s.title}
              </a>
              {s.price != null && <span className="font-mono">{fmt(s.price)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
