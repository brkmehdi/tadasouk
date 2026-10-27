"use client";

// The column of product cards on the right of the video. It takes touches itself, because iOS
// Safari does not scroll a box that has pointer-events: none, and it is only as tall as its cards,
// so the video below them stays free for taps and hold-to-frame. When the cards do not fit, it
// scrolls, fades the edge where more cards are hidden, and brings the current card into view.

import { useEffect, useRef, useState } from "react";

// Between the top bar and the caption + controls at the bottom.
const TOP = "max(3.25rem, calc(env(safe-area-inset-top) + 2.5rem))";
const MAX_H = `calc(100% - ${TOP} - 10.5rem - env(safe-area-inset-bottom))`;
const FADE = 28; // px

type Props = { currentId: string | null; children: React.ReactNode };

export default function ProductTray({ currentId, children }: Props) {
  const box = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ up: false, down: false });

  const measure = () => {
    const el = box.current;
    if (!el) return;
    const up = el.scrollTop > 2;
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setMore((m) => (m.up === up && m.down === down ? m : { up, down }));
  };

  // Cards added, removed or resized change what is hidden.
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    if (list.current) ro.observe(list.current);
    return () => ro.disconnect();
  }, []);

  // A new capture, or a product shown again, becomes current: scroll its card into view.
  useEffect(() => {
    const el = box.current;
    const card = currentId ? el?.querySelector<HTMLElement>(`[data-card="${currentId}"]`) : null;
    if (!el || !card) return;
    const top = card.offsetTop - FADE / 2;
    const bottom = card.offsetTop + card.offsetHeight + FADE / 2 - el.clientHeight;
    if (el.scrollTop > top) el.scrollTo({ top, behavior: "smooth" });
    else if (el.scrollTop < bottom) el.scrollTo({ top: bottom, behavior: "smooth" });
  }, [currentId]);

  const mask = `linear-gradient(to bottom, transparent 0, #000 ${more.up ? FADE : 0}px, #000 calc(100% - ${more.down ? FADE : 0}px), transparent 100%)`;

  return (
    <aside
      ref={box}
      onScroll={measure}
      className="no-scrollbar absolute end-0 w-[30vw] max-w-[8.5rem] touch-pan-y overflow-y-auto overscroll-contain"
      style={{ top: TOP, maxHeight: MAX_H, maskImage: mask, WebkitMaskImage: mask }}
    >
      <div ref={list} className="flex flex-col gap-3 ps-1 pe-2.5 pt-2 pb-2">
        {children}
      </div>
    </aside>
  );
}
