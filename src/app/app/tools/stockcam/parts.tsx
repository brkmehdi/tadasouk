"use client";

// Small pieces of the stock camera screen: the product card that flies from the item to the
// list, and the accuracy pill.

import { useEffect, useRef } from "react";

export type Rect = { x: number; y: number; w: number; h: number };

// The product photo flying from where the item was seen to the top of the list, as the capture
// screen's shot flies into its card.
export function Flyer({ img, label, from, to, onDone }: { img: string | null; label: string; from: Rect; to: Rect; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      done.current();
      return;
    }
    const at = (r: Rect) => ({ transform: `translate(${r.x}px, ${r.y}px)`, width: `${r.w}px`, height: `${r.h}px` });
    const anim = el.animate([{ ...at(from), opacity: 0.6 }, { ...at(from), opacity: 1, offset: 0.15 }, { ...at(to), opacity: 1 }], {
      duration: 650,
      easing: "cubic-bezier(0.55, 0, 0.2, 1)",
      fill: "forwards",
    });
    anim.onfinish = () => done.current();
    return () => anim.cancel();
  }, [from, to]);
  return (
    <div ref={ref} className="pointer-events-none fixed top-0 left-0 z-50 origin-top-left" style={{ width: from.w, height: from.h }} aria-hidden>
      <span className="block h-full w-full overflow-hidden rounded-xl bg-white shadow-2xl ring-2 ring-white">
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="h-full w-full object-contain" />
        )}
      </span>
      <span className="absolute -end-2 -top-2 rounded bg-white px-1 text-xs leading-5 font-semibold text-ink tabular-nums shadow">{label}</span>
    </div>
  );
}

// The share of movements that were not undone, as a small pill over the video.
export function Gauge({ value, label, sub }: { value: number | null; label: string; sub: string }) {
  const pct = value == null ? null : Math.round(value * 100);
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-xs backdrop-blur-xl">
      <span className="font-medium">{label}</span>
      <span className="font-semibold tabular-nums">{pct == null ? "·" : `${pct} %`}</span>
      <span className="text-white/60 tabular-nums">{sub}</span>
    </span>
  );
}
