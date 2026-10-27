"use client";

// Hold to frame. A finger resting on the video fills a ring shown just above it (so the finger
// does not hide it); after HOLD_MS a dashed frame appears, almost as big as the screen (a big
// frame needs less adjusting than a small one), and the AI shrinks it onto the product found
// under the finger. Still holding, moving the finger moves the frame. Then:
//   - drag inside the frame to move it,
//   - drag a corner or an edge handle to resize (edges change one side only),
//   - pinch with two fingers to scale it,
//   - tap outside the frame, or press the shutter, to photograph what is inside.
// While the merchant has not touched it, the frame snaps to the product the AI finds under the
// finger. This component keeps its own state so a drag only redraws the frame, not the whole
// capture screen (that is what made resizing feel slow).

import { useImperativeHandle, useRef, useState } from "react";

export type Frame = { x: number; y: number; w: number; h: number }; // screen pixels
export type FrameApi = { take: () => boolean };

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Mode = null | "hold" | "move" | "pinch" | Handle;

type Props = {
  ref?: React.Ref<FrameApi>;
  onCapture: (frame: Frame) => void;
  locate: (x: number, y: number) => Promise<Frame | null>;
  // "hold": a finger is resting (auto-capture waits); "frame": the frame is shown.
  onFramingChange: (state: "hold" | "frame" | null) => void;
  onQuickTap: () => void;
};

const HOLD_MS = 1000;
const MIN = 64;
const RING_LIFT = 92; // px above the finger

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function clamp(fr: Frame): Frame {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const w = Math.min(Math.max(fr.w, MIN), W);
  const h = Math.min(Math.max(fr.h, MIN), H);
  return { x: Math.min(Math.max(fr.x, 0), W - w), y: Math.min(Math.max(fr.y, 0), H - h), w, h };
}

export default function FrameOverlay({ ref, onCapture, locate, onFramingChange, onQuickTap }: Props) {
  const [frame, setFrameState] = useState<Frame | null>(null);
  const [hold, setHold] = useState<{ x: number; y: number; n: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<Frame | null>(null);
  const touchedRef = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{ mode: Mode; x: number; y: number; orig: Frame | null; timer: number; dist0: number; mid0: { x: number; y: number } }>({
    mode: null,
    x: 0,
    y: 0,
    orig: null,
    timer: 0,
    dist0: 1,
    mid0: { x: 0, y: 0 },
  });

  const setFrame = (fr: Frame | null) => {
    const had = frameRef.current != null;
    frameRef.current = fr;
    setFrameState(fr);
    if (had !== (fr != null)) onFramingChange(fr ? "frame" : null);
  };

  const take = () => {
    const fr = frameRef.current;
    if (!fr) return false;
    setFrame(null);
    onCapture(fr);
    return true;
  };
  useImperativeHandle(ref, () => ({ take }));

  const pair = () => {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // best effort: some pointers cannot be captured
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = g.current;
    const fr = frameRef.current;

    // Second finger on a frame: pinch.
    if (fr && pointers.current.size === 2) {
      const p = pair();
      s.mode = "pinch";
      s.orig = fr;
      s.dist0 = p.dist;
      s.mid0 = p.mid;
      touchedRef.current = true;
      setDragging(true);
      return;
    }
    if (pointers.current.size > 1) return;

    if (fr) {
      const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-handle]")?.dataset.handle as Handle | undefined;
      const inside = e.clientX >= fr.x && e.clientX <= fr.x + fr.w && e.clientY >= fr.y && e.clientY <= fr.y + fr.h;
      if (!handle && !inside) {
        take();
        return;
      }
      s.mode = handle ?? "move";
      s.x = e.clientX;
      s.y = e.clientY;
      s.orig = fr;
      touchedRef.current = true;
      setDragging(true);
      return;
    }

    s.mode = "hold";
    s.x = e.clientX;
    s.y = e.clientY;
    setHold({ x: e.clientX, y: e.clientY, n: Date.now() });
    onFramingChange("hold");
    clearTimeout(s.timer);
    s.timer = window.setTimeout(() => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      // Nearly the whole picture, between the top bar and the controls.
      const big = clamp({ x: W * 0.06, y: H * 0.1, w: W * 0.88, h: H * 0.66 });
      touchedRef.current = false;
      setHold(null);
      setFrame(big);
      s.mode = "move";
      s.orig = big;
      setDragging(true);
      navigator.vibrate?.(20);
      void locate(s.x, s.y).then((found) => {
        if (found && !touchedRef.current && frameRef.current) setFrame(clamp(found));
      });
    }, HOLD_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = g.current;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const o = s.orig;

    if (s.mode === "hold") {
      if (Math.hypot(dx, dy) > 14) {
        clearTimeout(s.timer);
        s.mode = null;
        setHold(null);
        onFramingChange(null);
      }
    } else if (s.mode === "move" && o) {
      if (Math.hypot(dx, dy) < 6) return;
      touchedRef.current = true;
      setFrame(clamp({ ...o, x: o.x + dx, y: o.y + dy }));
    } else if (s.mode === "pinch" && o && pointers.current.size >= 2) {
      const p = pair();
      const k = p.dist / s.dist0;
      const w = Math.max(MIN, o.w * k);
      const h = Math.max(MIN, o.h * k);
      const cx = o.x + o.w / 2 + (p.mid.x - s.mid0.x);
      const cy = o.y + o.h / 2 + (p.mid.y - s.mid0.y);
      setFrame(clamp({ x: cx - w / 2, y: cy - h / 2, w, h }));
    } else if (s.mode && s.mode.length <= 2 && o) {
      // A handle: move only the sides it names.
      const m = s.mode;
      let { x, y, w, h } = o;
      if (m.includes("w")) {
        x = Math.min(o.x + dx, o.x + o.w - MIN);
        w = o.x + o.w - x;
      } else if (m.includes("e")) {
        w = Math.max(MIN, o.w + dx);
      }
      if (m.includes("n")) {
        y = Math.min(o.y + dy, o.y + o.h - MIN);
        h = o.y + o.h - y;
      } else if (m.includes("s")) {
        h = Math.max(MIN, o.h + dy);
      }
      setFrame(clamp({ x, y, w, h }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const s = g.current;
    if (s.mode === "hold") {
      clearTimeout(s.timer);
      setHold(null);
      onFramingChange(null);
      onQuickTap();
    }
    if (s.mode === "pinch" && pointers.current.size === 1) {
      // one finger still down: carry on moving from where it is
      const [rest] = [...pointers.current.values()];
      s.mode = "move";
      s.x = rest.x;
      s.y = rest.y;
      s.orig = frameRef.current;
      return;
    }
    if (pointers.current.size === 0) {
      s.mode = null;
      setDragging(false);
    }
  };

  return (
    <div
      className="absolute inset-0 touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {hold && (
        <svg
          key={hold.n}
          className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 drop-shadow"
          style={{ left: hold.x, top: Math.max(40, hold.y - RING_LIFT) }}
          viewBox="0 0 64 64"
          aria-hidden
        >
          <circle cx="32" cy="32" r="26" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.35)" strokeWidth="4" />
          <circle
            cx="32"
            cy="32"
            r="26"
            fill="none"
            stroke="white"
            strokeWidth="4"
            strokeLinecap="round"
            className="hold-ring"
            style={{ animationDuration: `${HOLD_MS}ms` }}
          />
        </svg>
      )}

      {frame && (
        <div
          className={`${dragging ? "" : "frame-box"} absolute rounded-md border-2 border-dashed border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]`}
          style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
        >
          {HANDLES.map((h) => (
            <span key={h} data-handle={h} className={`frame-handle frame-handle-${h}`} aria-hidden>
              <span />
            </span>
          ))}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setFrame(null)}
            aria-label="Annuler le cadrage"
            className="absolute -top-11 left-0 flex h-8 items-center rounded-full bg-black/55 px-3 text-xs font-medium text-white backdrop-blur"
          >
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}
