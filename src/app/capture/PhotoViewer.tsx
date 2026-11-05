"use client";

// Full-screen preview of a product's photos, best first. Swipe between them; each shows its
// quality score (sharpness, light, framing, background). From here a photo becomes the main one
// or is removed.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { displayName, type Product, type ProductImage } from "@/lib/capture/session";

type Props = {
  p: Product;
  start: number;
  onClose: () => void;
  onCover: (imageId: string) => void;
  onRemove: (imageId: string) => void;
};

function sourceLabel(im: ProductImage) {
  if (im.source === "camera") return "Votre photo";
  if (im.source === "studio") return "Studio (votre photo, fond retouché)";
  if (im.source === "ai") return `Image IA${im.credit ? ` · ${im.credit}` : ""}`;
  return `Photo du web · ${im.credit ?? "site"}`;
}

export default function PhotoViewer({ p, start, onClose, onCover, onRemove }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(Math.min(start, p.images.length - 1));
  const at = Math.min(index, p.images.length - 1); // stays valid after a removal
  const current = p.images[at];

  // Open on the photo that was tapped.
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.clientWidth * Math.min(start, p.images.length - 1);
    // only when the viewer opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The last photo removed: nothing left to show.
  useEffect(() => {
    if (!p.images.length) onClose();
  }, [p.images.length, onClose]);

  if (!current) return null;
  const isCover = at === 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-label={`Photos de ${displayName(p)}`}>
      <div className="flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium tabular-nums">
            {at + 1} / {p.images.length}
          </p>
          <p className="truncate text-xs text-white/60">{sourceLabel(current)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 active:scale-90"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2 2l8 8m0-8l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div
        ref={stripRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / el.clientWidth);
          if (i !== at && i >= 0 && i < p.images.length) setIndex(i);
        }}
        className="no-scrollbar flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto"
      >
        {p.images.map((im) => (
          <div key={im.id} className="flex h-full w-full shrink-0 snap-center items-center justify-center px-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={im.url} alt="" className="max-h-full max-w-full rounded-lg bg-white object-contain" />
          </div>
        ))}
      </div>

      <div className="rounded-t-2xl bg-white px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink">
        <Quality q={current.quality} />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={isCover}
            onClick={() => {
              onCover(current.id);
              stripRef.current?.scrollTo({ left: 0, behavior: "smooth" });
            }}
            className="ui-btn ui-btn-primary h-11"
          >
            {isCover ? "Photo principale" : "Mettre en principale"}
          </button>
          <button type="button" onClick={() => onRemove(current.id)} className="ui-btn ui-btn-secondary h-11 text-danger">
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

const VERDICTS = [
  { min: 85, text: "Excellente", className: "text-ok" },
  { min: 70, text: "Bonne", className: "text-ok" },
  { min: 50, text: "Moyenne", className: "text-ink-2" },
  { min: 0, text: "Faible", className: "text-danger" },
];

function Quality({ q }: { q: ProductImage["quality"] }) {
  if (q === undefined) return null;
  if (q === "loading") {
    return (
      <div className="flex items-center gap-3">
        <span className="ui-skel h-12 w-12 shrink-0 animate-pulse rounded-full" />
        <div className="flex-1 space-y-2">
          <span className="ui-skel block h-3 w-32 animate-pulse" />
          <span className="ui-skel block h-3 w-48 animate-pulse" />
        </div>
      </div>
    );
  }
  if (q === "error") return <p className="text-sm text-ink-3">La note de qualité n’est pas disponible pour cette photo.</p>;
  const verdict = VERDICTS.find((v) => q.score >= v.min)!;
  const bars: [string, number][] = [
    ...(q.fidelity != null ? ([["Fidélité", q.fidelity]] as [string, number][]) : []),
    ["Netteté", q.sharpness],
    ["Lumière", q.lighting],
    ["Cadrage", q.framing],
    ["Fond", q.background],
  ];
  return (
    <div>
      <div className="flex items-center gap-3">
        <ScoreRing value={q.score} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${verdict.className}`}>Qualité {verdict.text.toLowerCase()}</p>
          <p dir="auto" className="text-[13px] leading-snug text-ink-2">
            {q.note}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {bars.map(([label, v]) => (
          <div key={label}>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(0, Math.min(10, v)) * 10}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              {label} <span className="tabular-nums">{v}/10</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const c = 2 * Math.PI * 21;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" className="shrink-0" aria-label={`Note ${v} sur 100`}>
      <circle cx="26" cy="26" r="21" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="5" />
      <circle
        cx="26"
        cy="26"
        r="21"
        fill="none"
        stroke={v >= 70 ? "var(--ok)" : v >= 50 ? "var(--ink)" : "var(--danger)"}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`}
        transform="rotate(-90 26 26)"
      />
      <text x="26" y="30.5" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--ink)">
        {v}
      </text>
    </svg>
  );
}
