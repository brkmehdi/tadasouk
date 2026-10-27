"use client";

import type { ObjectDetector } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";
import { ghostCrop, grabKeyframe, segment, SegmentError, type Keyframe } from "@/lib/capture/cutout";
import { createDetector, pickTarget, StillnessTrigger, type Box, type Target } from "@/lib/capture/detector";
import { emptyMetrics, report, type Metrics } from "@/lib/capture/metrics";
import {
  addCaptured,
  agentView,
  applyCalls,
  initialSession,
  patchProduct,
  purgeRemoved,
  type Product,
  type SessionState,
  type ToolCall,
} from "@/lib/capture/session";
import { startVoice } from "@/lib/capture/voice";

type Phase = "idle" | "starting" | "recording" | "stopped";
type Caption = { id: number; text: string; kind: "heard" | "pending" | "question" | "error" };

const CUE = /\b(this one|that one|hada|hadi|hadou|celui[- ]ci|celle[- ]ci|ceci)\b|هادا|هادي|هذا|هذه/i;
const DETECT_EVERY_MS = 66;

export default function CaptureScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<ObjectDetector | null>(null);
  const targetRef = useRef<Target | null>(null);
  const drawBoxRef = useRef<Box | null>(null);
  const triggerRef = useRef(new StillnessTrigger());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const voiceRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const sessionIdRef = useRef("");
  const startedAtRef = useRef(0);
  const metricsRef = useRef<Metrics>(emptyMetrics());
  const lastCaptureAtRef = useRef(-Infinity);
  const speechSnapRef = useRef<Keyframe | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionRef = useRef<SessionState>(initialSession());
  const captionIdRef = useRef(0);
  const loopRef = useRef(0);
  const lastDetectRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSessionState] = useState<SessionState>(initialSession);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [detectorState, setDetectorState] = useState<"off" | "loading" | "ready" | "failed">("off");
  const [level, setLevel] = useState({ rms: 0, speaking: false });
  const [metricsView, setMetricsView] = useState(report(emptyMetrics()));
  const [showMetrics, setShowMetrics] = useState(false);
  const [upload, setUpload] = useState<string | null>(null);

  const setSession = useCallback((next: SessionState) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  const caption = useCallback((text: string, kind: Caption["kind"], replaceId?: number) => {
    const id = replaceId ?? ++captionIdRef.current;
    setCaptions((list) => {
      const rest = list.filter((c) => c.id !== id);
      return [...rest, { id, text, kind }].slice(-3);
    });
    return id;
  }, []);

  const refreshMetrics = useCallback(() => setMetricsView(report(metricsRef.current)), []);

  // ---------- capture: keyframe -> instant card -> SAM cutout ----------
  const capture = useCallback(
    (k: Keyframe, label: string | null) => {
      const triggeredAt = performance.now();
      lastCaptureAtRef.current = triggeredAt;
      const id = crypto.randomUUID();
      setSession(addCaptured(sessionRef.current, { id, label, ghostUrl: ghostCrop(k), capturedAt: Date.now() }));
      navigator.vibrate?.(30);
      segment(sessionIdRef.current, k)
        .then((cut) => {
          const ms = performance.now() - triggeredAt;
          if (cut) {
            setSession(patchProduct(sessionRef.current, id, { cutoutUrl: cut.url, color: cut.color, status: "ready" }));
            metricsRef.current.capture.push({ at: Date.now(), ms, parts: { sam: cut.samMs } });
          } else {
            setSession(patchProduct(sessionRef.current, id, { status: "failed" }));
          }
          refreshMetrics();
        })
        .catch((err: unknown) => {
          setSession(patchProduct(sessionRef.current, id, { status: "failed" }));
          caption(err instanceof SegmentError ? err.message : "Segmentation failed", "error");
        });
      return id;
    },
    [caption, refreshMetrics, setSession],
  );

  const centerBox = (v: HTMLVideoElement): Box => {
    const s = Math.min(v.videoWidth, v.videoHeight) * 0.55;
    return { x: (v.videoWidth - s) / 2, y: (v.videoHeight - s) / 2, w: s, h: s };
  };

  // ---------- detection loop ----------
  const step = useCallback(() => {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    const detector = detectorRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const now = performance.now();

    if (detector && now - lastDetectRef.current >= DETECT_EVERY_MS) {
      lastDetectRef.current = now;
      const t0 = performance.now();
      const target = pickTarget(detector, video, now, targetRef.current);
      const dt = performance.now() - t0;
      const m = metricsRef.current;
      m.detectMs.push(dt);
      if (m.detectMs.length > 300) m.detectMs.shift();
      targetRef.current = target;
      if (target && m.firstHighlightMs == null) {
        m.firstHighlightMs = now - startedAtRef.current;
        refreshMetrics();
      }
      if (triggerRef.current.update(target, video.videoWidth, video.videoHeight, now) && target) {
        capture(grabKeyframe(video, target.box), target.label);
      }
    }
    draw(canvas, video, targetRef.current, drawBoxRef, triggerRef.current.progress(now));
  }, [capture, refreshMetrics]);

  // ---------- voice: chunk -> transcript -> (cue capture) -> agent -> UI ----------
  const handleChunk = useCallback(
    (wav: ArrayBuffer, info: { startedAt: number; endedAt: number }) => {
      const snap = speechSnapRef.current;
      const label = targetRef.current?.label ?? null;
      const pendingId = caption("…", "pending");
      queueRef.current = queueRef.current.then(async () => {
        try {
          const tr = await fetch(`/api/transcribe?sessionId=${sessionIdRef.current}`, {
            method: "POST",
            headers: { "Content-Type": "audio/wav" },
            body: wav,
          });
          const tj = (await tr.json()) as { transcript?: string; message?: string };
          if (!tr.ok) throw new Error(tj.message ?? "Transcription failed");
          const asrDone = performance.now();
          const text = (tj.transcript ?? "").trim();
          if (!text) {
            setCaptions((l) => l.filter((c) => c.id !== pendingId));
            return;
          }
          caption(text, "heard", pendingId);

          // "this one" / "hada" captures the frame from when the merchant started talking,
          // unless the held-still trigger already took one during this sentence.
          if (CUE.test(text) && snap && lastCaptureAtRef.current < info.startedAt - 1500) {
            capture(snap, label);
          }

          const ar = await fetch("/api/agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sessionIdRef.current,
              transcript: text,
              state: agentView(sessionRef.current),
            }),
          });
          const aj = (await ar.json()) as { calls?: ToolCall[]; message?: string };
          if (!ar.ok) throw new Error(aj.message ?? "Agent failed");
          const calls = aj.calls ?? [];
          if (!calls.length) return;
          const applied = applyCalls(sessionRef.current, calls, () => crypto.randomUUID());
          setSession(applied.state);
          if (applied.question) caption(applied.question, "question");
          if (applied.state.products.some((p) => p.status === "removing")) {
            setTimeout(() => setSession(purgeRemoved(sessionRef.current)), 450);
          }
          requestAnimationFrame(() => {
            const done = performance.now();
            metricsRef.current.command.push({
              at: Date.now(),
              ms: done - info.endedAt,
              parts: { asr: asrDone - info.endedAt, agent: done - asrDone },
            });
            refreshMetrics();
          });
        } catch (err) {
          caption(err instanceof Error ? err.message : String(err), "error", pendingId);
        }
      });
    },
    [caption, capture, refreshMetrics, setSession],
  );

  // ---------- start / stop ----------
  const start = useCallback(async () => {
    setPhase("starting");
    setUpload(null);
    sessionIdRef.current = crypto.randomUUID();
    metricsRef.current = emptyMetrics();
    refreshMetrics();
    setSession(initialSession(sessionRef.current.currency));
    setCaptions([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      startedAtRef.current = performance.now();

      const mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => uploadVideo(new Blob(chunks, { type: rec.mimeType }), sessionIdRef.current, setUpload);
      rec.start(1000);
      recorderRef.current = rec;

      voiceRef.current = await startVoice(stream, {
        onSpeechStart: () => {
          const v = videoRef.current;
          if (v) speechSnapRef.current = grabKeyframe(v, targetRef.current?.box ?? centerBox(v));
        },
        onChunk: handleChunk,
        onLevel: (rms, speaking) => setLevel({ rms, speaking }),
      });

      wakeLockRef.current = await navigator.wakeLock?.request("screen").catch(() => null);
      setPhase("recording");
      const frame = () => {
        step();
        loopRef.current = requestAnimationFrame(frame);
      };
      loopRef.current = requestAnimationFrame(frame);

      if (!detectorRef.current) {
        setDetectorState("loading");
        createDetector()
          .then((d) => {
            detectorRef.current = d;
            setDetectorState("ready");
          })
          .catch(() => setDetectorState("failed"));
      }
    } catch (err) {
      caption(err instanceof Error ? err.message : String(err), "error");
      setPhase("idle");
    }
  }, [caption, handleChunk, step, refreshMetrics, setSession]);

  const stop = useCallback(async () => {
    cancelAnimationFrame(loopRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    await voiceRef.current?.stop();
    voiceRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    await wakeLockRef.current?.release().catch(() => {});
    targetRef.current = null;
    drawBoxRef.current = null;
    const c = overlayRef.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setLevel({ rms: 0, speaking: false });
    setPhase("stopped");
    setShowMetrics(true);
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(loopRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  // Tap on the video: capture whatever is under the finger (fallback when the detector
  // does not know the product).
  const onTap = (e: React.PointerEvent) => {
    const v = videoRef.current;
    if (phase !== "recording" || !v) return;
    const rect = v.getBoundingClientRect();
    const scale = Math.max(rect.width / v.videoWidth, rect.height / v.videoHeight);
    const vx = (e.clientX - rect.left - (rect.width - v.videoWidth * scale) / 2) / scale;
    const vy = (e.clientY - rect.top - (rect.height - v.videoHeight * scale) / 2) / scale;
    const t = targetRef.current;
    const inside = t && vx >= t.box.x && vx <= t.box.x + t.box.w && vy >= t.box.y && vy <= t.box.y + t.box.h;
    const s = Math.min(v.videoWidth, v.videoHeight) * 0.4;
    const box: Box = inside
      ? t.box
      : {
          x: Math.max(0, Math.min(v.videoWidth - s, vx - s / 2)),
          y: Math.max(0, Math.min(v.videoHeight - s, vy - s / 2)),
          w: s,
          h: s,
        };
    triggerRef.current.markManualCapture(box, performance.now());
    capture(grabKeyframe(v, box), inside ? t.label : null);
  };

  const products = [...session.products].sort((a, b) => b.order - a.order);

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white select-none">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
        onPointerDown={onTap}
      />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {phase === "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-neutral-900 to-black px-8 text-center">
          <p className="text-2xl font-semibold">Filmez vos produits et parlez</p>
          <p className="text-lg text-neutral-300" dir="rtl">
            صوّر السلعة ديالك و هضر
          </p>
          <p className="max-w-xs text-sm text-neutral-400">
            Hold each product still in the middle, then say its price. Example: &ldquo;hada b miya&rdquo;, &ldquo;20% off&rdquo;.
          </p>
        </div>
      )}

      {/* product tray */}
      <aside className="absolute inset-y-0 end-0 flex w-[30vw] max-w-36 flex-col gap-2 overflow-y-auto px-2 pt-14 pb-40">
        {products.map((p) => (
          <ProductCard key={p.id} p={p} current={p.id === session.currentId} />
        ))}
      </aside>

      {/* top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-3 text-xs">
        {phase === "recording" && (
          <span className="flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> REC
          </span>
        )}
        {detectorState === "loading" && <span className="rounded-full bg-black/50 px-2.5 py-1">Loading detector…</span>}
        {detectorState === "failed" && (
          <span className="rounded-full bg-black/50 px-2.5 py-1">No detector: tap a product</span>
        )}
        <button
          onClick={() => setShowMetrics((v) => !v)}
          className="ms-auto rounded-full bg-black/50 px-2.5 py-1 font-mono"
          aria-label="Latency"
        >
          ⏱ {metricsView.captureP50 != null ? `${(metricsView.captureP50 / 1000).toFixed(1)}s` : "–"} /{" "}
          {metricsView.commandP50 != null ? `${(metricsView.commandP50 / 1000).toFixed(1)}s` : "–"}
        </button>
      </div>

      {showMetrics && (
        <MetricsPanel m={metricsView} upload={upload} onClose={() => setShowMetrics(false)} />
      )}

      {/* captions */}
      <div className="pointer-events-none absolute inset-x-0 bottom-36 flex flex-col items-center gap-1 px-4 pe-[32vw]">
        {captions.map((c) => (
          <p
            key={c.id}
            dir="auto"
            className={`max-w-full rounded-xl px-3 py-1.5 text-center text-base leading-snug backdrop-blur ${
              c.kind === "error"
                ? "bg-red-600/80"
                : c.kind === "question"
                  ? "bg-amber-400/90 font-semibold text-black"
                  : c.kind === "pending"
                    ? "bg-black/40 text-neutral-300"
                    : "bg-black/60"
            }`}
          >
            {c.text}
          </p>
        ))}
      </div>

      {/* record button */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center pb-[max(2rem,env(safe-area-inset-bottom))]">
        <button
          onClick={phase === "recording" ? stop : start}
          disabled={phase === "starting"}
          aria-label={phase === "recording" ? "Stop" : "Record"}
          className="relative flex h-24 w-24 items-center justify-center rounded-full border-4 border-white/90 shadow-lg"
          style={{ boxShadow: level.speaking ? `0 0 0 ${4 + level.rms * 120}px rgba(255,255,255,0.18)` : undefined }}
        >
          <span
            className={`block bg-red-500 transition-all duration-200 ${
              phase === "recording" ? "h-9 w-9 rounded-lg" : "h-20 w-20 rounded-full"
            }`}
          />
        </button>
      </div>
    </main>
  );
}

function ProductCard({ p, current }: { p: Product; current: boolean }) {
  const img = p.cutoutUrl ?? p.ghostUrl;
  return (
    <div
      className={`card-in relative shrink-0 rounded-2xl bg-white/10 p-1.5 backdrop-blur-md transition-all ${
        current ? "ring-2 ring-amber-300" : ""
      } ${p.status === "removing" ? "card-out" : ""}`}
    >
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-white/5">
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={p.name ?? p.label ?? ""}
            className={`max-h-full max-w-full object-contain transition-all duration-500 ${
              p.cutoutUrl ? "drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]" : "opacity-60 blur-[1px]"
            }`}
          />
        )}
        {p.status === "segmenting" && <div className="shimmer absolute inset-0" />}
        {p.question && (
          <span className="absolute end-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-black">
            ?
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
    </div>
  );
}

// The price types itself in, one character at a time.
function PriceChip({ value, currency }: { value: number; currency: string }) {
  const text = formatPrice(value, currency);
  return (
    <span key={text} className="type-in rounded-md bg-amber-300 px-1.5 py-0.5 font-mono text-sm font-bold text-black" style={{ "--chars": text.length } as React.CSSProperties}>
      {text}
    </span>
  );
}

function formatPrice(v: number, currency: string) {
  const n = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return currency === "EUR" ? `${n} €` : `${n} DH`;
}

function MetricsPanel({
  m,
  upload,
  onClose,
}: {
  m: ReturnType<typeof report>;
  upload: string | null;
  onClose: () => void;
}) {
  const s = (v: number | null) => (v == null ? "–" : `${Math.round(v)} ms`);
  const rows: [string, string, string][] = [
    ["First highlight", s(m.firstHighlightMs), "< 1000"],
    ["Detector / frame p50 · p95", `${s(m.detectP50)} · ${s(m.detectP95)}`, ""],
    [`Capture → card p50 · p95 (n=${m.captureN})`, `${s(m.captureP50)} · ${s(m.captureP95)}`, "< 3000"],
    ["  of which SAM p50", s(m.samP50), ""],
    [`Command → UI p50 · p95 (n=${m.commandN})`, `${s(m.commandP50)} · ${s(m.commandP95)}`, "< 3000"],
    ["  transcription p50", s(m.asrP50), ""],
    ["  agent p50", s(m.agentP50), ""],
  ];
  return (
    <div className="absolute inset-x-3 top-12 z-10 rounded-2xl bg-black/80 p-3 font-mono text-[11px] backdrop-blur">
      <div className="mb-2 flex items-center">
        <b className="text-xs">Phase 0 latency</b>
        <button className="ms-auto px-2" onClick={() => navigator.clipboard?.writeText(JSON.stringify(m, null, 2))}>
          copy
        </button>
        <button className="px-2" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <table className="w-full">
        <tbody>
          {rows.map(([k, v, target]) => (
            <tr key={k}>
              <td className="pe-2 whitespace-pre text-neutral-300">{k}</td>
              <td className="text-end">{v}</td>
              <td className="ps-2 text-end text-neutral-500">{target}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {upload && <p className="mt-2 text-neutral-300">Video: {upload}</p>}
    </div>
  );
}

// ---------- overlay drawing ----------
function draw(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  target: Target | null,
  smooth: React.RefObject<Box | null>,
  progress: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!target) {
    smooth.current = null;
    return;
  }
  const prev = smooth.current;
  const k = 0.45;
  const b = prev
    ? {
        x: prev.x + (target.box.x - prev.x) * k,
        y: prev.y + (target.box.y - prev.y) * k,
        w: prev.w + (target.box.w - prev.w) * k,
        h: prev.h + (target.box.h - prev.h) * k,
      }
    : target.box;
  smooth.current = b;

  const scale = Math.max(cw / video.videoWidth, ch / video.videoHeight);
  const ox = (cw - video.videoWidth * scale) / 2;
  const oy = (ch - video.videoHeight * scale) / 2;
  const x = ox + b.x * scale;
  const y = oy + b.y * scale;
  const w = b.w * scale;
  const h = b.h * scale;
  const r = Math.min(24, w / 4, h / 4);

  ctx.save();
  ctx.shadowColor = "rgba(255, 200, 80, 0.95)";
  ctx.shadowBlur = 24;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 220, 120, 0.95)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.stroke();
  ctx.restore();

  if (progress > 0) {
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "white";
    ctx.beginPath();
    ctx.arc(x + w / 2, y - 18, 10, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- raw video -> R2 (signed URL, straight from the browser) ----------
async function uploadVideo(blob: Blob, sessionId: string, onStatus: (s: string) => void) {
  const mb = (blob.size / 1e6).toFixed(1);
  try {
    onStatus(`${mb} MB, uploading…`);
    const res = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, contentType: blob.type }),
    });
    if (res.status === 503) {
      onStatus(`${mb} MB, kept on the phone (R2 not configured yet)`);
      return;
    }
    const { url, contentType, key } = (await res.json()) as { url: string; contentType: string; key: string };
    const put = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
    onStatus(put.ok ? `${mb} MB uploaded to R2 (${key})` : `upload failed (${put.status})`);
  } catch (err) {
    onStatus(`upload failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
