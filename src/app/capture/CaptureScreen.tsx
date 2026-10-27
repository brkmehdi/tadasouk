"use client";

import type { ObjectDetector } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ghostCrop, grabKeyframe, segment, SegmentError, type Keyframe } from "@/lib/capture/cutout";
import { createDetector, pickTarget, StillnessTrigger, type Box, type Target } from "@/lib/capture/detector";
import { emptyMetrics, report, type Metrics } from "@/lib/capture/metrics";
import { innerRegion, signature, similarity, type Signature } from "@/lib/capture/similarity";
import { betterPhotos, checkPrice, identify, studioPhoto } from "@/lib/capture/product-actions";
import { shutter } from "@/lib/capture/sfx";
import {
  addCaptured,
  addImage,
  agentView,
  applyCalls,
  displayName,
  dropImage,
  editProduct,
  initialSession,
  makeCover,
  nextQuestion,
  patchImage,
  patchProduct,
  purgeRemoved,
  removeProduct,
  suggestionPatch,
  type Effect,
  type ProductImage,
  type Question,
  type SessionState,
  type ToolCall,
} from "@/lib/capture/session";
import { explainMediaError, openCamera, type MediaHelp } from "@/lib/capture/media";
import { startVoice } from "@/lib/capture/voice";
import ProductCard from "./ProductCard";
import ProductSheet from "./ProductSheet";
import ConfirmRemove from "./ConfirmRemove";

type Phase = "idle" | "starting" | "recording" | "stopped";
type Caption = { id: number; text: string; kind: "heard" | "pending" | "question" | "error" };

const CUE = /\b(this one|that one|hada|hadi|hadou|celui[- ]ci|celle[- ]ci|ceci)\b|هادا|هادي|هذا|هذه/i;
const DETECT_EVERY_MS = 66;
// Similarity above which a capture counts as a product already in the tray (see similarity.ts).
const SAME_CROP = 0.74;
const SAME_CUTOUT = 0.76;

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
  const attachIdRef = useRef<string | null>(null);
  const sigsRef = useRef(new Map<string, { crops: Signature[]; cutouts: Signature[] }>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const identifyingRef = useRef(new Map<string, Promise<void>>());
  // Auto-capture takes one product, then waits for "+" (or "produit suivant") so the camera
  // does not grab whatever passes while the merchant talks about the current product.
  const armedRef = useRef(true);

  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSessionState] = useState<SessionState>(initialSession);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [detectorState, setDetectorState] = useState<"off" | "loading" | "ready" | "failed">("off");
  const [level, setLevel] = useState({ rms: 0, speaking: false });
  const [metricsView, setMetricsView] = useState(report(emptyMetrics()));
  const [showMetrics, setShowMetrics] = useState(false);
  const [upload, setUpload] = useState<string | null>(null);
  const [attachId, setAttachIdState] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; from: DOMRect } | null>(null);
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const [help, setHelp] = useState<MediaHelp | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [shutterN, setShutterN] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [armed, setArmedState] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // The latency panel is for testing only: add ?debug to the address.
  const debug = useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(location.search).has("debug"),
    () => false,
  );

  const setSession = useCallback((next: SessionState) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  // One line of text at a time; it fades out after a few seconds ("pending" waits for its result).
  const caption = useCallback((text: string, kind: Caption["kind"], replaceId?: number) => {
    const id = replaceId ?? ++captionIdRef.current;
    setCaptions((list) => {
      const rest = list.filter((c) => c.id !== id);
      return [...rest, { id, text, kind }].slice(-3);
    });
    if (kind !== "pending") {
      const ttl = kind === "error" ? 6000 : kind === "question" ? 9000 : 4000;
      setTimeout(() => setCaptions((list) => list.filter((c) => c.id !== id)), ttl);
    }
    return id;
  }, []);

  const setArmed = useCallback((v: boolean) => {
    armedRef.current = v;
    setArmedState(v);
  }, []);

  const refreshMetrics = useCallback(() => setMetricsView(report(metricsRef.current)), []);

  // "+" on a card: the next captures add photos to that product instead of making new ones.
  const setAttach = useCallback((id: string | null) => {
    attachIdRef.current = id;
    setAttachIdState(id);
  }, []);

  // ---------- slow product actions: AI photos, price check ----------
  const runEffect = useCallback(
    (effect: Effect): Promise<void> | void => {
      const sid = sessionIdRef.current || crypto.randomUUID();
      if (effect.kind === "next_product") {
        setArmed(true);
        return;
      }
      const product = sessionRef.current.products.find((p) => p.id === effect.productId);
      if (!product) return;
      if (effect.kind === "better_photos") {
        if (product.photos === "loading") return;
        setSession(patchProduct(sessionRef.current, product.id, { photos: "loading" }));
        return betterPhotos(sid, product, (url) =>
          setSession(addImage(sessionRef.current, product.id, { id: crypto.randomUUID(), url, source: "ai", pending: false })),
        )
          .then(() => setSession(patchProduct(sessionRef.current, product.id, { photos: "idle" })))
          .catch((err: unknown) => {
            setSession(patchProduct(sessionRef.current, product.id, { photos: "error" }));
            caption(err instanceof Error ? err.message : String(err), "error");
          });
      } else {
        if (product.priceCheck?.status === "loading") return;
        setSession(patchProduct(sessionRef.current, product.id, { priceCheck: { status: "loading" } }));
        return checkPrice(sid, product).then((check) => {
          const now = sessionRef.current.products.find((p) => p.id === product.id);
          if (!now) return;
          const patch: Partial<typeof now> = { priceCheck: check };
          // The web search knows the exact product better than the photo alone.
          if (check.status === "done" && check.name_fr) {
            patch.suggested = { name: check.name_fr, description: check.description_fr || now.suggested.description };
            if (check.name_ar) patch.nameAr = check.name_ar;
            if (check.category) patch.category = check.category;
          }
          setSession(patchProduct(sessionRef.current, product.id, patch));
          if (check.status === "error") caption(check.message, "error");
        });
      }
    },
    [caption, setArmed, setSession],
  );


  // ---------- naming and research ----------
  // Right after the cutout: name the product from its photo (only fills what the merchant
  // has not set).
  const runIdentify = useCallback(
    (id: string) => {
      const product = sessionRef.current.products.find((p) => p.id === id);
      if (!product || product.identify !== "idle") return;
      setSession(patchProduct(sessionRef.current, id, { identify: "loading" }));
      const job = identify(sessionIdRef.current, product)
        .then((who) => {
          const now = sessionRef.current.products.find((p) => p.id === id);
          if (!now) return;
          const patch: Partial<typeof now> = { identify: who ? "done" : "failed" };
          if (who && !now.suggested.name) {
            // A first guess from the photo; the web research replaces it when it lands.
            patch.suggested = { name: who.name_fr || null, description: who.confident ? who.description_fr : null };
            patch.nameAr = who.name_ar || null;
            patch.category = who.category || null;
          }
          setSession(patchProduct(sessionRef.current, id, patch));
        })
        .catch(() => setSession(patchProduct(sessionRef.current, id, { identify: "failed" })))
        .finally(() => identifyingRef.current.delete(id));
      identifyingRef.current.set(id, job);
    },
    [setSession],
  );

  const runStudio = useCallback(
    (productId: string, image: ProductImage) => {
      if (!image.cutoutUrl) return Promise.resolve();
      return studioPhoto(sessionIdRef.current, image.cutoutUrl)
        .then(({ url }) =>
          setSession(addImage(sessionRef.current, productId, { id: crypto.randomUUID(), url, source: "studio", pending: false })),
        )
        .catch(() => {
          // The plain white photo stays; nothing to tell the merchant.
        });
    },
    [setSession],
  );

  // As soon as a product is cut out: its studio photo, then (once named) photos guided by
  // the web and the product research (exact name, description, prices in Morocco).
  const researchProduct = useCallback(
    async (id: string, image: ProductImage) => {
      const product = sessionRef.current.products.find((p) => p.id === id);
      if (!product || product.research !== "idle" || product.status !== "active") return;
      setSession(patchProduct(sessionRef.current, id, { research: "running" }));
      const studio = runStudio(id, image);
      await identifyingRef.current.get(id);
      await Promise.allSettled([
        studio,
        runEffect({ kind: "better_photos", productId: id }),
        runEffect({ kind: "check_price", productId: id }),
      ]);
      setSession(patchProduct(sessionRef.current, id, { research: "done" }));
    },
    [runEffect, runStudio, setSession],
  );

  // ---------- capture: keyframe -> instant card -> SAM cutout ----------
  // Showing a product that is already in the tray selects its card instead of adding a copy.
  // Checked twice: on the raw crop before calling SAM (saves the call), then on the precise
  // cutout (catches what the crop missed). A tap always captures.
  const bestMatch = useCallback((sig: Signature, kind: "crops" | "cutouts", exclude?: string) => {
    let best: { id: string; score: number } | null = null;
    for (const p of sessionRef.current.products) {
      if (p.id === exclude || p.status === "removing") continue;
      for (const other of sigsRef.current.get(p.id)?.[kind] ?? []) {
        const score = similarity(sig, other);
        if (!best || score > best.score) best = { id: p.id, score };
      }
    }
    return best;
  }, []);

  const sigsOf = (id: string) => {
    let e = sigsRef.current.get(id);
    if (!e) sigsRef.current.set(id, (e = { crops: [], cutouts: [] }));
    return e;
  };

  const selectExisting = useCallback(
    (id: string, score: number) => {
      setSession({ ...sessionRef.current, currentId: id });
      setFlash({ id, n: Date.now() });
      navigator.vibrate?.([15, 40, 15]);
      metricsRef.current.dupes.push(score);
      refreshMetrics();
    },
    [refreshMetrics, setSession],
  );

  const capture = useCallback(
    (k: Keyframe, label: string | null, mode: "auto" | "voice" | "tap") => {
      const triggeredAt = performance.now();
      lastCaptureAtRef.current = triggeredAt;
      const crop = signature(k.canvas, innerRegion(k.box));
      const attachTo = sessionRef.current.products.find(
        (p) => p.id === attachIdRef.current && p.status !== "removing",
      );
      const dedupe = !attachTo && mode !== "tap";
      if (dedupe) {
        const match = bestMatch(crop, "crops");
        metricsRef.current.lastSimilarity = match?.score ?? null;
        if (match && match.score >= SAME_CROP) {
          sigsOf(match.id).crops.push(crop); // one more view of it for next time
          selectExisting(match.id, match.score);
          return match.id;
        }
      }

      const imageId = crypto.randomUUID();
      const ghostUrl = ghostCrop(k);
      const id = attachTo?.id ?? crypto.randomUUID();
      sigsOf(id).crops.push(crop);
      if (!attachTo) setArmed(false); // one product per "+"
      // Shutter: flash, click, and the shot flies from where it was taken into its card.
      shutter(audioCtxRef.current);
      setShutterN((n) => n + 1);
      const from = videoRef.current ? screenRect(videoRef.current, k) : null;
      if (from) setShots((list) => [...list, { id: imageId, url: ghostUrl, from, productId: id }]);
      setSession(
        attachTo
          ? addImage(sessionRef.current, id, { id: imageId, url: ghostUrl, source: "camera", pending: true })
          : addCaptured(sessionRef.current, { id, imageId, label, ghostUrl }),
      );
      navigator.vibrate?.(30);
      segment(sessionIdRef.current, k)
        .then((cut) => {
          const ms = performance.now() - triggeredAt;
          if (cut && dedupe) {
            const match = bestMatch(cut.sig, "cutouts", id);
            if (match && match.score >= SAME_CUTOUT) {
              // A copy slipped through: drop the new card, keep the original.
              sigsOf(match.id).crops.push(crop);
              sigsRef.current.delete(id);
              setSession(patchProduct(sessionRef.current, id, { status: "removing" }));
              setTimeout(() => setSession(purgeRemoved(sessionRef.current)), 450);
              selectExisting(match.id, match.score);
              return;
            }
          }
          if (cut) sigsOf(id).cutouts.push(cut.sig);
          let next = patchImage(
            sessionRef.current,
            id,
            imageId,
            cut ? { url: cut.url, cutoutUrl: cut.cutoutUrl, pending: false } : { pending: false },
          );
          const product = next.products.find((p) => p.id === id);
          if (cut && product && !product.color) next = patchProduct(next, id, { color: cut.color });
          setSession(next);
          const img = next.products.find((p) => p.id === id)?.images.find((i) => i.id === imageId);
          if (cut && !attachTo && img) {
            runIdentify(id);
            void researchProduct(id, img);
          }
          // A photo added later to a product gets its studio version too.
          if (cut && attachTo && img) void runStudio(id, img);
          if (cut) metricsRef.current.capture.push({ at: Date.now(), ms, parts: { sam: cut.samMs } });
          refreshMetrics();
        })
        .catch((err: unknown) => {
          setSession(patchImage(sessionRef.current, id, imageId, { pending: false }));
          caption(err instanceof SegmentError ? err.message : "Segmentation failed", "error");
        });
      return id;
    },
    [bestMatch, caption, refreshMetrics, researchProduct, runIdentify, runStudio, selectExisting, setArmed, setSession],
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
      if (armedRef.current && triggerRef.current.update(target, video.videoWidth, video.videoHeight, now) && target) {
        capture(grabKeyframe(video, target.box), target.label, "auto");
      }
    }
    const show = armedRef.current ? targetRef.current : null;
    draw(canvas, video, show, drawBoxRef, show ? triggerRef.current.progress(now) : 0);
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
          // When no new product is expected, "hada" just means the current one.
          if (armedRef.current && CUE.test(text) && snap && lastCaptureAtRef.current < info.startedAt - 1500) {
            capture(snap, label, "voice");
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
          applied.effects.forEach(runEffect);
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
    [caption, capture, refreshMetrics, runEffect, setSession],
  );

  // ---------- start / stop ----------
  const start = useCallback(async () => {
    // Created inside the tap, before any await: iOS keeps audio started later silent.
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    setPhase("starting");
    setHelp(null);
    setUpload(null);
    sessionIdRef.current = crypto.randomUUID();
    metricsRef.current = emptyMetrics();
    refreshMetrics();
    setSession(initialSession(sessionRef.current.currency));
    setAttach(null);
    setOpen(null);
    setDismissed([]);
    setConfirmId(null);
    setArmed(true);
    sigsRef.current.clear();
    setCaptions([]);

    // The camera is the only step that must work; the others degrade with a caption.
    let stream: MediaStream;
    try {
      stream = await openCamera();
    } catch (err) {
      audioCtx.close().catch(() => {});
      setHelp(explainMediaError(err));
      setPhase("idle");
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current!;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => caption("Touchez l'écran si l'image reste figée", "pending"));
    startedAtRef.current = performance.now();

    try {
      const mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => uploadVideo(new Blob(chunks, { type: rec.mimeType }), sessionIdRef.current, setUpload);
      rec.start(1000);
      recorderRef.current = rec;
    } catch {
      recorderRef.current = null;
      setUpload("not recorded on this phone");
    }

    try {
      voiceRef.current = await startVoice(audioCtx, stream, {
        onSpeechStart: () => {
          const v = videoRef.current;
          if (v) speechSnapRef.current = grabKeyframe(v, targetRef.current?.box ?? centerBox(v));
        },
        onChunk: handleChunk,
        onLevel: (rms, speaking) => setLevel({ rms, speaking }),
      });
    } catch (err) {
      caption(`Micro indisponible : ${err instanceof Error ? err.message : String(err)}`, "error");
    }

    wakeLockRef.current = (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;
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
  }, [caption, handleChunk, step, refreshMetrics, setArmed, setAttach, setSession]);

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
    audioCtxRef.current = null;
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
    const s = Math.min(v.videoWidth, v.videoHeight) * 0.75;
    const box: Box = inside
      ? t.box
      : {
          x: Math.max(0, Math.min(v.videoWidth - s, vx - s / 2)),
          y: Math.max(0, Math.min(v.videoHeight - s, vy - s / 2)),
          w: s,
          h: s,
        };
    triggerRef.current.markManualCapture(box, performance.now());
    capture(grabKeyframe(v, box, inside ? undefined : { x: vx, y: vy }), inside ? t.label : null, "tap");
  };

  const products = [...session.products].sort((a, b) => b.order - a.order);
  const openProduct = open ? session.products.find((p) => p.id === open.id && p.status !== "removing") : undefined;
  const attachProduct = attachId ? session.products.find((p) => p.id === attachId) : undefined;
  const confirmProduct = confirmId ? session.products.find((p) => p.id === confirmId) : undefined;

  const removeNow = (id: string) => {
    setSession(removeProduct(sessionRef.current, id));
    if (attachIdRef.current === id) setAttach(null);
    if (open?.id === id) setOpen(null);
    setTimeout(() => setSession(purgeRemoved(sessionRef.current)), 450);
  };
  const onOpen = (id: string, from: DOMRect) => {
    setSession({ ...sessionRef.current, currentId: id }); // voice commands now apply to it
    setArmed(false); // editing, not filming the next product
    setOpen({ id, from });
  };
  const onAttach = (id: string) => setAttach(attachIdRef.current === id ? null : id);
  const applySuggestions = (id: string) => {
    const p = sessionRef.current.products.find((x) => x.id === id);
    if (p) setSession(editProduct(sessionRef.current, id, suggestionPatch(p)));
  };

  // One line of text at a time, centered above the record button. Most recent first:
  // what was just heard or answered, else the "next product" hint, else one question about
  // what is missing (asked only while the merchant is quiet).
  const keyOf = (q: Question) => `${q.productId}:${q.text}`;
  const candidates =
    phase === "recording"
      ? [session.products.find((p) => p.id === session.currentId)]
      : phase === "stopped"
        ? [...session.products].sort((a, b) => a.order - b.order)
        : [];
  const question =
    level.speaking || open
      ? null
      : (candidates
          .map((p) => (p ? nextQuestion(p) : null))
          .find((q): q is Question => !!q && !dismissed.includes(keyOf(q))) ?? null);
  const latest = captions.at(-1) ?? null;
  const showHint = phase === "recording" && armed && session.products.length > 0 && !latest;
  const openFromCard = (id: string) => {
    const el = document.querySelector(`[data-card="${id}"]`);
    if (el) onOpen(id, el.getBoundingClientRect());
  };
  const recording = phase === "recording";

  return (
    <main className={`fixed inset-0 overflow-hidden select-none ${phase === "idle" ? "bg-white text-ink" : "bg-black text-white"}`}>
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        className="absolute inset-0 h-full w-full object-cover"
        onPointerDown={onTap}
      />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {phase === "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white px-6 pb-28 text-center">
          {help ? (
            <div className="ui-card w-full max-w-sm p-5 text-start">
              <p className="text-base font-medium">{help.title}</p>
              <ol className="mt-3 list-decimal space-y-2 ps-5 text-sm leading-snug text-ink-2">
                {help.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="mt-4 text-[13px] text-ink-3">Ensuite, touchez le bouton rouge.</p>
            </div>
          ) : (
            <>
              <p className="text-[22px] leading-tight font-semibold tracking-tight">Filmez vos produits et parlez</p>
              <p className="mt-2 text-base text-ink-3" dir="rtl">
                صوّر السلعة ديالك و هضر
              </p>
              <p className="mt-4 max-w-xs text-sm leading-snug text-ink-3">
                Montrez un produit au centre, puis dites son prix. Exemple : « hada b miya », « 20% de remise ».
              </p>
            </>
          )}
        </div>
      )}

      {/* product tray: ends above the text and the controls */}
      <aside className="absolute end-0 top-[max(3.25rem,calc(env(safe-area-inset-top)+2.5rem))] bottom-[calc(10.5rem+env(safe-area-inset-bottom))] flex w-[30vw] max-w-[8.5rem] flex-col gap-3 overflow-y-auto ps-1 pe-2.5 pt-2 pb-2">
        {products.map((p) => (
          <ProductCard
            key={p.id}
            p={p}
            current={p.id === session.currentId}
            flash={flash?.id === p.id ? flash.n : 0}
            onOpen={onOpen}
            onRemove={setConfirmId}
          />
        ))}
      </aside>

      {/* top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-xs">
        {recording && (
          <span className="flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 font-medium backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> REC
          </span>
        )}
        {recording && detectorState === "loading" && <span className="rounded-full bg-black/45 px-2.5 py-1 backdrop-blur">Préparation…</span>}
        {recording && detectorState === "failed" && (
          <span className="rounded-full bg-black/45 px-2.5 py-1 backdrop-blur">Touchez un produit pour le prendre</span>
        )}
        {debug && (
          <button
            onClick={() => setShowMetrics((v) => !v)}
            className="ms-auto rounded-full bg-black/45 px-2.5 py-1 font-mono backdrop-blur"
            aria-label="Latence"
          >
            ⏱ {metricsView.captureP50 != null ? `${(metricsView.captureP50 / 1000).toFixed(1)}s` : "–"} /{" "}
            {metricsView.commandP50 != null ? `${(metricsView.commandP50 / 1000).toFixed(1)}s` : "–"}
          </button>
        )}
      </div>

      {attachProduct && (
        <div className="absolute inset-x-0 top-14 z-10 flex justify-center px-3">
          <div className="flex items-center gap-3 rounded-full bg-white py-1 ps-4 pe-1 text-sm font-medium text-ink shadow-lg">
            <span dir="auto" className="truncate">
              Photos pour « {displayName(attachProduct)} »
            </span>
            <button type="button" onClick={() => setAttach(null)} className="ui-btn ui-btn-primary h-8 rounded-full px-3">
              OK
            </button>
          </div>
        </div>
      )}

      {/* shutter: white flash, then each shot flies into its card */}
      {shutterN > 0 && <div key={shutterN} className="shutter-flash pointer-events-none absolute inset-0 bg-white" />}
      {shots.map((shot) => (
        <FlyingShot key={shot.id} shot={shot} onDone={() => setShots((l) => l.filter((x) => x.id !== shot.id))} />
      ))}

      {/* one centered line of text, two lines at most */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(6.25rem+env(safe-area-inset-bottom))] z-10 flex justify-center px-4">
        {latest ? (
          <p
            key={latest.id}
            dir="auto"
            className={`line-clamp-2 max-w-[min(88vw,24rem)] rounded-2xl px-3.5 py-2 text-center text-sm leading-snug shadow-lg ${
              latest.kind === "error"
                ? "bg-white font-medium text-danger"
                : latest.kind === "question"
                  ? "bg-white font-medium text-ink"
                  : latest.kind === "pending"
                    ? "bg-black/45 text-white/75 backdrop-blur"
                    : "bg-black/55 text-white backdrop-blur"
            }`}
          >
            {latest.text}
          </p>
        ) : showHint ? (
          <p className="rounded-2xl bg-black/45 px-3.5 py-2 text-center text-sm text-white/90 backdrop-blur">
            Montrez le produit suivant
          </p>
        ) : question ? (
          <div className="pointer-events-auto flex max-w-[min(92vw,26rem)] items-center gap-2 rounded-2xl bg-white py-1.5 ps-3.5 pe-1.5 text-ink shadow-lg">
            <button type="button" onClick={() => openFromCard(question.productId)} className="min-w-0 flex-1 py-0.5">
              <p dir="auto" className="line-clamp-2 text-center text-sm leading-snug font-medium">
                {question.text}
              </p>
            </button>
            {question.action && (
              <button
                type="button"
                onClick={() => setSession(editProduct(sessionRef.current, question.productId, question.action!.patch))}
                className="ui-btn ui-btn-primary h-8 shrink-0 px-3 text-[13px]"
              >
                {question.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => setDismissed((d) => [...d, keyOf(question)])}
              aria-label="Plus tard"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-soft"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path d="M1.5 1.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>

      {/* controls: small record button with echoes while the merchant talks, "+" for the next product */}
      <div className="absolute inset-x-0 bottom-0 flex h-[calc(5.5rem+env(safe-area-inset-bottom))] items-start justify-center pt-3">
        <button
          onClick={recording ? stop : start}
          disabled={phase === "starting"}
          aria-label={recording ? "Arrêter" : "Filmer"}
          className={`relative flex h-16 w-16 items-center justify-center rounded-full ring-[3px] ${
            phase === "idle" ? "ring-ink/80" : "ring-white"
          }`}
        >
          {recording && level.speaking && (
            <>
              <span className="echo" />
              <span className="echo" />
              <span className="echo" />
            </>
          )}
          <span
            className={`block bg-red-500 transition-all duration-200 ${recording ? "h-6 w-6 rounded-md" : "h-[52px] w-[52px] rounded-full"}`}
          />
        </button>
        {recording && session.products.length > 0 && (
          <button
            type="button"
            onClick={() => setArmed(true)}
            aria-label="Produit suivant"
            aria-pressed={armed}
            className={`absolute end-5 top-4 flex h-12 w-12 items-center justify-center rounded-full ring-1 backdrop-blur transition-colors ${
              armed ? "armed-pulse bg-white text-ink ring-white" : "bg-white/20 text-white ring-white/40"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path d="M9 2v14M2 9h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {openProduct && open && (
        <ProductSheet
          key={openProduct.id}
          p={openProduct}
          from={open.from}
          attaching={attachId === openProduct.id}
          onClose={() => setOpen(null)}
          onEdit={(patch) => setSession(editProduct(sessionRef.current, openProduct.id, patch))}
          onUseAll={() => applySuggestions(openProduct.id)}
          onRemoveImage={(imageId) => setSession(dropImage(sessionRef.current, openProduct.id, imageId))}
          onCover={(imageId) => setSession(makeCover(sessionRef.current, openProduct.id, imageId))}
          onAttach={() => onAttach(openProduct.id)}
          onBetterPhotos={() => runEffect({ kind: "better_photos", productId: openProduct.id })}
          onCheckPrice={() => runEffect({ kind: "check_price", productId: openProduct.id })}
          onRemove={() => setConfirmId(openProduct.id)}
        />
      )}

      {confirmProduct && (
        <ConfirmRemove
          p={confirmProduct}
          onCancel={() => setConfirmId(null)}
          onConfirm={() => {
            removeNow(confirmProduct.id);
            setConfirmId(null);
          }}
        />
      )}

      {debug && showMetrics && <MetricsPanel m={metricsView} upload={upload} onClose={() => setShowMetrics(false)} />}
    </main>
  );
}

const noSubscribe = () => () => {};

type Shot = { id: string; url: string; from: { left: number; top: number; width: number; height: number }; productId: string };

// Where a keyframe's box sits on screen (the video is drawn with object-fit: cover).
function screenRect(video: HTMLVideoElement, k: Keyframe) {
  const r = video.getBoundingClientRect();
  const toVideo = video.videoWidth / k.canvas.width;
  const scale = Math.max(r.width / video.videoWidth, r.height / video.videoHeight);
  const ox = r.left + (r.width - video.videoWidth * scale) / 2;
  const oy = r.top + (r.height - video.videoHeight * scale) / 2;
  return {
    left: ox + k.box.x * toVideo * scale,
    top: oy + k.box.y * toVideo * scale,
    width: k.box.w * toVideo * scale,
    height: k.box.h * toVideo * scale,
  };
}

// The captured photo pops up where it was taken, zooms a little, then flies into its card.
function FlyingShot({ shot, onDone }: { shot: Shot; onDone: () => void }) {
  const ref = useRef<HTMLImageElement>(null);
  // The screen re-renders many times a second (mic level); the animation must not restart.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = document.querySelector(`[data-card="${shot.productId}"]`)?.getBoundingClientRect();
    const { left, top, width, height } = shot.from;
    const to = target
      ? `translate(${target.left + target.width / 2 - (left + width / 2)}px, ${target.top + target.width / 2 - (top + height / 2)}px) scale(${(target.width * 0.8) / Math.max(width, height)})`
      : "scale(0.2)";
    const a = el.animate(
      [
        { transform: "scale(1)", opacity: 1, offset: 0 },
        { transform: "scale(1.12)", opacity: 1, offset: 0.3 },
        { transform: to, opacity: 0.85, offset: 1 },
      ],
      { duration: 650, easing: "cubic-bezier(0.5, 0, 0.2, 1)", fill: "forwards" },
    );
    a.onfinish = () => done.current();
    return () => a.cancel();
  }, [shot]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={shot.url}
      alt=""
      className="pointer-events-none fixed z-30 rounded-xl object-cover shadow-2xl ring-2 ring-white"
      style={{ left: shot.from.left, top: shot.from.top, width: shot.from.width, height: shot.from.height }}
    />
  );
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
    [`Same product shown again (n=${m.dupes})`, m.lastSimilarity == null ? "–" : `last ${m.lastSimilarity.toFixed(2)}`, ""],
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
