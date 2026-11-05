"use client";

// Stock camera: a phone on a stand over the counter records every sale (Sortie) and every
// delivery (Entrée) on its own. A barcode counts at once (−1 or +1; it must leave the view before
// it counts again). Without a barcode, when something new sits still in the middle for about a
// second, one frame goes to /api/stockcam, which says which product it is and how many units.
// Each movement lands in the list with the stock before and after, and can be undone with a tap;
// "Précision" is the share not undone, and a product corrected lately is asked about (Oui / Non)
// before it is counted again. Writes go through the merchant's session (stockcam/movements.ts).
// The camera stops when the tab is hidden and on exit; the screen stays awake while it runs.

import { useEffect, useMemo, useRef, useState } from "react";
import { readBarcode, warmUpBarcodes } from "@/lib/capture/barcode";
import { explainMediaError, openCamera, watchPressure, type MediaHelp } from "@/lib/capture/media";
import { sameBarcode } from "@/lib/capture/session";
import { beep } from "@/lib/capture/sfx";
import { catalogGrid, countCells, MAX_CELLS, MAX_IMAGE } from "@/lib/catalog/count";
import { coverOf, type CatalogProduct } from "@/lib/catalog/types";
import { useT } from "@/lib/i18n";
import { accuracy, askFirst, loadMovements, newestFirst, recordMovement, revertMovement, RECENT, type Movement } from "./stockcam/movements";
import { Flyer, Gauge, type Rect } from "./stockcam/parts";
import css from "./stockcam/stockcam.module.css";
import { fill, WORDS } from "./stockcam/strings";
import { CounterWatch, frameJpeg } from "./stockcam/watch";
import type { ToolProps } from "./types";

type Mode = "sale" | "delivery";
type How = "barcode" | "ai";
type Box = { x: number; y: number; w: number; h: number }; // 0-1 of the frame
type Frozen = { url: string; fw: number; fh: number; box: Box | null; name: string | null; confidence: number | null };
type Ask = { p: CatalogProduct; n: number; confidence: number; how: How; reason: "corrected" | "unsure"; from: Rect; mode: Mode };
type Seen = {
  present?: boolean;
  productId?: string | null;
  count?: number;
  confidence?: number;
  box?: Box | null;
  error?: string;
  message?: string;
};

const TICK_MS = 200; // the picture is looked at this often (40 px grey copy)
const HOT_TICK_MS = 400; // when the phone reports it is hot
const BARCODE_MS = 500;
const HOT_BARCODE_MS = 1200;
const GONE_MS = 1500; // a barcode not read for this long has left the view: it can count again
const CODE_BLOCKS_AI_MS = 2000; // a barcode read lately: the scene is not sent to the AI
const SURE = 0.6; // under this the AI's answer is asked about

const signed = (d: number) => (d < 0 ? `−${-d}` : `+${d}`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const nextKey = () => ++seq; // keys that replay an animation

// Where a box of the frame falls on the stage, which shows the video as object-cover.
function coverRect(b: Box, cw: number, ch: number, fw: number, fh: number): Rect {
  const k = Math.max(cw / fw, ch / fh);
  const dx = (cw - fw * k) / 2;
  const dy = (ch - fh * k) / 2;
  return { x: dx + b.x * fw * k, y: dy + b.y * fh * k, w: b.w * fw * k, h: b.h * fh * k };
}

export default function StockCamera({ store, products, onExit, onChanged }: ToolProps) {
  const { lang } = useT();
  const s = WORDS[lang];
  const [sessionId] = useState(() => crypto.randomUUID());
  const [watch] = useState(() => new CounterWatch(1000));
  const [midnight] = useState(() => {
    const d = new Date();
    return d.setHours(0, 0, 0, 0);
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const gridRef = useRef<{ key: string; url: string } | null>(null);
  const gate = useRef(false); // an analysis or a question is on: nothing else is counted
  const changed = useRef(false);
  const codeSeen = useRef({ code: "", at: 0 });
  const lastCodeAt = useRef(0);
  const listNow = useRef<Movement[]>([]);
  const act = useRef<{ onCode: (code: string, now: number) => void; onScene: (now: number) => void; start: () => void }>({
    onCode: () => {},
    onScene: () => {},
    start: () => {},
  });

  const [mode, setMode] = useState<Mode>("sale");
  const [list, setList] = useState<Movement[]>([]);
  const [stocks, setStocks] = useState(() => new Map(products.map((p) => [p.id, p.stock])));
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [pop, setPop] = useState<{ key: number; text: string; name: string } | null>(null);
  const [fly, setFly] = useState<{ key: number; img: string | null; label: string; from: Rect; to: Rect } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [help, setHelp] = useState<MediaHelp | null>(null);
  const [ready, setReady] = useState(false);
  const [hold, setHold] = useState(0);
  const [aiOff, setAiOff] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [undoing, setUndoing] = useState<string | null>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  // The photos the AI compares with: products without a barcode first (a barcode is faster).
  const cells = useMemo(() => {
    const all = countCells(products);
    const coded = (id: string) => !!byId.get(id)?.barcode;
    return [...all.filter((c) => !coded(c.productId)), ...all.filter((c) => coded(c.productId))].slice(0, MAX_CELLS);
  }, [products, byId]);
  const productsInGrid = new Set(cells.map((c) => c.productId)).size;

  const todays = list.filter((m) => Date.parse(m.createdAt) >= midnight);
  const counted = todays.filter((m) => !m.revertedAt);
  const sold = counted.filter((m) => m.source === "camera_sale").reduce((t, m) => t - m.delta, 0);
  const received = counted.filter((m) => m.source === "camera_delivery").reduce((t, m) => t + m.delta, 0);
  const acc = accuracy(list);
  const nameOf = (p: CatalogProduct) => p.name || s.noName;

  const say = (text: string) => setToast({ text, n: nextKey() });
  const setMovements = (fn: (l: Movement[]) => Movement[]) => {
    listNow.current = fn(listNow.current);
    setList(listNow.current);
  };

  // ---------- geometry ----------
  const stageBox = () => stageRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight / 2);
  const centerRect = (): Rect => {
    const r = stageBox();
    const size = Math.min(130, r.width * 0.35);
    return { x: r.left + r.width / 2 - size / 2, y: r.top + r.height / 2 - size / 2, w: size, h: size };
  };
  const listSlot = (): Rect => {
    const el = listRef.current;
    el?.scrollTo({ top: 0, behavior: "smooth" });
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top + 10, w: 40, h: 40 } : { x: 16, y: window.innerHeight - 120, w: 40, h: 40 };
  };

  const unfreeze = () => {
    setFrozen(null);
    setBusy(false);
    gate.current = false;
  };

  // ---------- counting ----------
  const commit = async (p: CatalogProduct, n: number, confidence: number, how: How, from: Rect, confirmed: boolean, m0: Mode) => {
    const delta = m0 === "sale" ? -n : n;
    const label = signed(delta);
    setPop({ key: nextKey(), text: label, name: nameOf(p) });
    beep(audio.current);
    if (delta > 0) setTimeout(() => beep(audio.current), 140);
    navigator.vibrate?.(delta < 0 ? 40 : [30, 60, 30]);
    const wasAsking = askFirst(listNow.current, p.id);
    try {
      const m = await recordMovement({
        storeId: store.id,
        productId: p.id,
        delta,
        source: delta < 0 ? "camera_sale" : "camera_delivery",
        confidence,
        how,
        confirmed,
      });
      changed.current = true;
      setMovements((l) => [m, ...l]);
      setStocks((st) => new Map(st).set(p.id, m.after));
      setFresh(m.id);
      setFly({ key: nextKey(), img: coverOf(p), label, from, to: listSlot() });
      if (wasAsking && !askFirst(listNow.current, p.id)) setTimeout(() => say(fill(s.relearnt, { p: nameOf(p) })), 1200);
    } catch {
      say(s.saveFailed);
    }
  };

  // Counted silently, or asked first when the product was corrected lately or the AI is unsure.
  const decide = (p: CatalogProduct, n: number, confidence: number, how: How, from: Rect, m0: Mode) => {
    const corrected = askFirst(listNow.current, p.id);
    if (corrected || confidence < SURE) {
      gate.current = true;
      setAsk({ p, n, confidence, how, reason: corrected ? "corrected" : "unsure", from, mode: m0 });
      return "asked";
    }
    void commit(p, n, confidence, how, from, false, m0);
    return "counted";
  };

  const answer = (ok: boolean) => {
    const a = ask;
    setAsk(null);
    if (ok && a) void commit(a.p, a.n, a.confidence, a.how, a.from, true, a.mode);
    setTimeout(unfreeze, ok ? 900 : 0);
  };

  // One frame to the AI. `known`: the product its barcode named (a delivery), only the units are counted.
  const analyse = async (known?: CatalogProduct) => {
    const v = videoRef.current;
    if (!v || gate.current) return;
    const url = frameJpeg(v, MAX_IMAGE);
    if (!url) return;
    const scene = watch.last;
    const m0 = mode;
    const fw = v.videoWidth;
    const fh = v.videoHeight;
    gate.current = true;
    setFrozen({ url, fw, fh, box: null, name: null, confidence: null });
    setBusy(true);
    setStep(0);
    try {
      const key = cells.map((c) => c.url).join("|");
      if (gridRef.current?.key !== key) gridRef.current = { key, url: await catalogGrid(cells) };
      const index = known ? cells.findIndex((c) => c.productId === known.id) + 1 : 0;
      const res = await fetch("/api/stockcam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          frame: url,
          grid: gridRef.current.url,
          cells: cells.map((c) => ({ productId: c.productId, colorId: c.colorId })),
          mode: m0,
          ...(index ? { known: index } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Seen;
      if (!res.ok) {
        const off = res.status === 401 || res.status === 402 || data.error === "missing_key";
        if (off) setAiOff(true);
        throw new Error(off && data.message ? data.message : s.aiFailed);
      }
      const p = known ?? (data.productId ? byId.get(data.productId) : undefined);
      if (!p) {
        if (!data.present) watch.markEmpty(scene);
        say(data.present ? s.notInCatalog : s.nothing);
        unfreeze();
        return;
      }
      const n = Math.max(1, data.count ?? 1);
      const confidence = known ? 1 : (data.confidence ?? 0);
      const box = data.box ?? null;
      setBusy(false);
      setFrozen((f) => f && { ...f, box, name: nameOf(p), confidence });
      await wait(box ? 950 : 400);
      const r = stageBox();
      const from = box ? coverRect(box, r.width, r.height, fw, fh) : centerRect();
      if (box) {
        from.x += r.left;
        from.y += r.top;
      }
      if (decide(p, n, confidence, known ? "barcode" : "ai", from, m0) === "asked") return;
      await wait(1000);
      unfreeze();
    } catch (e) {
      say(e instanceof Error && e.message ? e.message : s.aiFailed);
      unfreeze();
    }
  };

  // A barcode in view. The same code read again while it stays in view counts once.
  const onCode = (code: string, now: number) => {
    const again = codeSeen.current.code === code && now - codeSeen.current.at < GONE_MS;
    codeSeen.current = { code, at: now };
    lastCodeAt.current = now;
    watch.markSent();
    if (again || gate.current) return;
    const p = products.find((x) => x.status !== "archived" && sameBarcode(x.barcode, code));
    if (!p) return say(fill(s.unknownCode, { c: code }));
    // A delivery: the barcode says which product, the AI counts the units in the box.
    if (mode === "delivery" && !aiOff && cells.some((c) => c.productId === p.id)) return void analyse(p);
    decide(p, 1, 1, "barcode", centerRect(), mode);
  };

  // Something new sat still in the middle.
  const onScene = (now: number) => {
    if (aiOff || !cells.length || gate.current) return;
    if (now - lastCodeAt.current < CODE_BLOCKS_AI_MS) return;
    void analyse();
  };

  const undo = async (m: Movement) => {
    if (undoing) return;
    setUndoing(m.id);
    try {
      const r = await revertMovement(m);
      changed.current = true;
      setMovements((l) => l.map((x) => (x.id === m.id ? { ...x, revertedAt: r.revertedAt } : x)));
      setStocks((st) => new Map(st).set(m.productId, r.stock));
      const p = byId.get(m.productId);
      if (p) say(fill(s.learnt, { p: nameOf(p) }));
    } catch {
      say(s.undoFailed);
    } finally {
      setUndoing(null);
    }
  };

  const exit = () => {
    if (changed.current) onChanged();
    onExit();
  };

  // The loop below lives for the whole screen; it calls the latest handlers through this ref.
  useEffect(() => {
    act.current.onCode = onCode;
    act.current.onScene = onScene;
  });

  // ---------- camera, wake lock and the watching loop ----------
  useEffect(() => {
    const video = videoRef.current!;
    let stopped = false;
    let starting = false;
    let stream: MediaStream | null = null;
    let lock: WakeLockSentinel | null = null;
    let timer = 0;
    let hot = false;
    let scanning = false;
    let lastScan = 0;
    audio.current = new AudioContext();
    warmUpBarcodes();
    const pressure = watchPressure((h) => (hot = h));

    const release = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      void lock?.release().catch(() => {});
      lock = null;
    };
    const start = async () => {
      if (starting || stream || stopped || document.hidden) return;
      starting = true;
      try {
        const st = await openCamera();
        if (stopped || document.hidden) {
          st.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = st;
        video.muted = true;
        video.playsInline = true;
        video.srcObject = st;
        await video.play().catch(() => {});
        watch.reset(); // the counter is learnt again: the phone may have moved
        lock = (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;
        setHelp(null);
        setReady(true);
      } catch (err) {
        setHelp(explainMediaError(err));
      } finally {
        starting = false;
      }
    };
    act.current.start = () => void start();
    const onVisibility = () => {
      if (document.hidden) {
        release();
        setReady(false);
      } else void start();
    };

    const tick = () => {
      if (stopped) return;
      const now = performance.now();
      if (stream && !document.hidden && video.readyState >= 2 && !gate.current) {
        if (watch.update(video, now)) act.current.onScene(now);
        setHold(Math.round(watch.progress(now) * 10) / 10);
        if (!scanning && now - lastScan >= (hot ? HOT_BARCODE_MS : BARCODE_MS)) {
          scanning = true;
          lastScan = now;
          readBarcode(video)
            .then((code) => {
              if (code && !stopped) act.current.onCode(code, performance.now());
            })
            .finally(() => (scanning = false));
        }
      }
      timer = window.setTimeout(tick, hot ? HOT_TICK_MS : TICK_MS);
    };

    document.addEventListener("visibilitychange", onVisibility);
    void start();
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      release();
      pressure?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      void audio.current?.close().catch(() => {});
    };
  }, [watch]);

  // Today's movements and the latest ones (for the accuracy) from earlier visits.
  useEffect(() => {
    let off = false;
    loadMovements(store.id)
      .then((loaded) => {
        if (off) return;
        const mine = new Set(listNow.current.map((m) => m.id));
        setMovements((l) => [...l, ...loaded.filter((m) => !mine.has(m.id))].sort(newestFirst));
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [store.id]);

  // The stage size, to place the AI's box over the frozen frame.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The steps shown while the AI looks, so the wait reads as work.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setStep((i) => Math.min(i + 1, s.steps.length - 1)), 1700);
    return () => clearInterval(id);
  }, [busy, s.steps.length]);

  const tapStage = () => {
    if (!ready || gate.current || aiOff || !cells.length) return;
    watch.markSent();
    void analyse();
  };

  const box = frozen?.box && stage.w ? coverRect(frozen.box, stage.w, stage.h, frozen.fw, frozen.fh) : null;
  const time = (iso: string) => new Date(iso).toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  const subHint = aiOff ? s.aiOff : !cells.length ? s.noPhotos : ready ? s.tapHint : null;

  return (
    <div className="fixed inset-0 flex flex-col bg-white text-ink select-none">
      {/* ---------- the picture ---------- */}
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden bg-black text-white">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        {frozen && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frozen.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <button type="button" onClick={tapStage} aria-label={s.tapHint} className="absolute inset-0 cursor-default" />

        {/* the item found */}
        {box && (
          <div
            className={`pointer-events-none absolute rounded-xl ring-2 ring-white ${css.lock}`}
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            aria-hidden
          >
            <span className="absolute -top-7 left-0 flex max-w-[70vw] items-center gap-1 rounded bg-white px-1.5 text-xs leading-5 font-semibold whitespace-nowrap text-ink shadow">
              <span dir="auto" className="truncate">
                {frozen?.name}
              </span>
              {frozen?.confidence != null && <span className="font-normal text-ink-3 tabular-nums">{Math.round(frozen.confidence * 100)} %</span>}
            </span>
          </div>
        )}

        {/* the middle of the counter: crop brackets, and a bar that fills while something new holds still */}
        {!frozen && ready && (
          <div className="pointer-events-none absolute inset-x-[14%] top-[24%] bottom-[18%]" aria-hidden>
            {(
              [
                "top-0 left-0 border-t-4 border-l-4 rounded-tl-md",
                "top-0 right-0 border-t-4 border-r-4 rounded-tr-md",
                "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-md",
                "bottom-0 right-0 border-b-4 border-r-4 rounded-br-md",
              ] as const
            ).map((c) => (
              <span key={c} className={`absolute h-[22px] w-[22px] border-white transition-opacity duration-300 ${hold > 0 ? "" : "opacity-70"} ${c}`} />
            ))}
            {hold > 0 && (
              <span className="absolute inset-x-10 -bottom-4 h-1 overflow-hidden rounded-full bg-white/25">
                <span className="block h-full rounded-full bg-white transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${hold * 100}%` }} />
              </span>
            )}
          </div>
        )}

        {/* top: close, what runs, the day's counters; accuracy on the other side */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={exit}
            aria-label={s.close}
            className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/20 backdrop-blur-xl"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 text-xs">
            <span className="flex max-w-full items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 font-medium backdrop-blur-xl">
              {ready && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ef4444]" />}
              <span className="truncate">
                {s.title} · {ready ? s.live : s.starting}
              </span>
            </span>
            <span className="flex flex-wrap gap-1.5">
              <Counter value={sold} label={s.salesToday} />
              <Counter value={received} label={s.receivedToday} />
            </span>
          </div>
          <Gauge value={acc} label={s.precision} sub={fill(s.lastN, { n: Math.min(RECENT, list.length) })} />
        </div>

        {/* the "−1" / "+24" just counted */}
        {pop && (
          <div key={pop.key} className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className={`flex flex-col items-center rounded-2xl bg-white px-5 py-2.5 text-ink shadow-lg ${css.pop}`}>
              <span className="text-[28px] leading-tight font-semibold tabular-nums">{pop.text}</span>
              <span dir="auto" className="max-w-[70vw] truncate text-[13px] text-ink-2">
                {pop.name}
              </span>
            </div>
          </div>
        )}

        {/* one caption at the bottom of the picture: the wait, or what to do */}
        {!ask && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-4">
            {busy ? (
              <p role="status" className="line-clamp-2 max-w-[min(88vw,24rem)] rounded-2xl bg-black/60 px-3.5 py-2 text-center text-sm leading-snug text-white/75 shadow-lg">
                {fill(s.steps[step], { n: productsInGrid })}
              </p>
            ) : (
              <p className="max-w-[min(88vw,24rem)] rounded-2xl bg-black/65 px-3.5 py-2 text-center text-sm leading-snug text-white shadow-lg">
                {mode === "sale" ? s.hintSale : s.hintDelivery}
                {subHint && <span className="mt-0.5 block text-[13px] text-white/70">{subHint}</span>}
              </p>
            )}
          </div>
        )}

        {/* the question: a product corrected lately, or the AI is unsure */}
        {ask && (
          <div className="absolute inset-x-3 bottom-3 z-20 flex justify-center">
            <div className={`w-full max-w-md rounded-2xl bg-white p-3 text-ink shadow-lg ${css.rise}`}>
              <div className="flex items-center gap-3">
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-black/10">
                  {coverOf(ask.p) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverOf(ask.p)!} alt="" className="h-full w-full object-contain" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate text-base font-medium">
                    {fill(s.askQ, { p: nameOf(ask.p) })}
                  </p>
                  <p className="text-[13px] text-ink-3">
                    {ask.reason === "corrected" ? s.askCorrected : fill(s.askUnsure, { n: Math.round(ask.confidence * 100) })}
                  </p>
                </div>
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => setAsk({ ...ask, n: Math.max(1, ask.n - 1) })} className="ui-btn ui-btn-soft h-8 w-8 p-0" aria-label="−">
                    −
                  </button>
                  <span className="min-w-[3ch] text-center text-[22px] font-semibold tabular-nums">{signed(ask.mode === "sale" ? -ask.n : ask.n)}</span>
                  <button type="button" onClick={() => setAsk({ ...ask, n: ask.n + 1 })} className="ui-btn ui-btn-soft h-8 w-8 p-0" aria-label="+">
                    +
                  </button>
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => answer(false)} className="ui-btn ui-btn-secondary h-11">
                  {s.no}
                </button>
                <button type="button" onClick={() => answer(true)} className="ui-btn ui-btn-primary h-11">
                  {s.yes}
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <p
            key={toast.n}
            dir="auto"
            className="toast pointer-events-none absolute inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+5.5rem)] z-30 mx-auto w-fit max-w-[min(88vw,24rem)] rounded-2xl bg-white px-3.5 py-2 text-center text-sm leading-snug font-medium text-ink shadow-lg [animation-duration:3.2s]"
          >
            {toast.text}
          </p>
        )}

        {help && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-white px-6 text-ink">
            <div className="ui-card w-full max-w-sm p-5">
              <p className="text-base font-medium">{help.title}</p>
              <ol className="mt-3 list-decimal space-y-2 ps-5 text-sm leading-snug text-ink-2">
                {help.steps.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => act.current.start()} className="ui-btn ui-btn-primary">
                  {s.retry}
                </button>
                <button type="button" onClick={exit} className="ui-btn ui-btn-secondary">
                  {s.close}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---------- mode and the movements, on white as on the sale screen ---------- */}
      <div className="shrink-0 border-t border-line bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex rounded-md bg-soft p-0.5" role="radiogroup">
          {(["sale", "delivery"] as const).map((m) => {
            const on = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMode(m)}
                className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded px-3 text-sm ${on ? "bg-white text-ink shadow-sm" : "text-ink-3"}`}
              >
                <span className="font-semibold">{m === "sale" ? s.sale : s.delivery}</span>
                <span className={on ? "text-ink-3" : ""}>{m === "sale" ? s.saleSub : s.deliverySub}</span>
              </button>
            );
          })}
        </div>

        <div ref={listRef} className="no-scrollbar mt-1 h-[30dvh] divide-y divide-line overflow-y-auto" data-testid="stockcam-list">
          {todays.length === 0 && <p className="px-6 pt-6 text-center text-sm text-ink-3">{s.emptyList}</p>}
          {todays.map((m) => {
            const p = byId.get(m.productId);
            const img = p ? coverOf(p) : null;
            const wrote = m.before !== null || m.after !== null;
            const now = stocks.get(m.productId);
            return (
              <div key={m.id} className={`flex items-center gap-3 py-2.5 ${fresh === m.id ? css.arrive : ""} ${m.revertedAt ? "opacity-50" : ""}`}>
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-black/10">
                  {img && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="" className="h-full w-full object-contain" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p dir="auto" className={`truncate text-sm font-medium ${m.revertedAt ? "line-through" : ""}`}>
                    {p ? nameOf(p) : s.noName}
                  </p>
                  <p className="text-[13px] text-ink-3 tabular-nums">
                    {wrote && m.after !== null ? (
                      <>
                        {s.stock} {m.before ?? 0} → <span className="font-semibold text-ink">{m.after}</span>
                      </>
                    ) : now != null ? (
                      `${s.stock} ${now}`
                    ) : (
                      s.notFollowed
                    )}
                  </p>
                  <p className="text-[11px] text-ink-3 tabular-nums">
                    {time(m.createdAt)}
                    {m.how && ` · ${m.how === "barcode" ? s.barcode : s.ai}`}
                    {m.how === "ai" && m.confidence != null && ` ${Math.round(m.confidence * 100)} %`}
                  </p>
                </div>
                <span className="text-[22px] leading-none font-semibold tabular-nums">{signed(m.delta)}</span>
                {m.revertedAt ? (
                  <span className="w-[72px] text-center text-[11px] font-medium text-ink-3">{s.undone}</span>
                ) : (
                  <button
                    type="button"
                    disabled={undoing === m.id}
                    onClick={() => void undo(m)}
                    className="ui-btn ui-btn-secondary h-8 w-[72px] shrink-0 px-2 text-[13px]"
                  >
                    {s.undo}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {fly && <Flyer key={fly.key} img={fly.img} label={fly.label} from={fly.from} to={fly.to} onDone={() => setFly(null)} />}
    </div>
  );
}

function Counter({ value, label }: { value: number; label: string }) {
  return (
    <span className="rounded-full bg-black/45 px-2.5 py-1 backdrop-blur-xl">
      <span className="font-semibold tabular-nums">{value}</span> {label}
    </span>
  );
}
