"use client";

import type { ObjectDetector } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";
import { createCatalogSync } from "@/lib/catalog/sync";
import { ghostCrop, grabKeyframe, locateProduct, segment, SegmentError, type Keyframe } from "@/lib/capture/cutout";
import { coversCenter, createDetector, pickTarget, StillnessTrigger, type Box, type Target } from "@/lib/capture/detector";
import { SceneTrigger } from "@/lib/capture/scene";
import { emptyMetrics, report, type Metrics } from "@/lib/capture/metrics";
import { innerRegion, signature, similarity, type Signature } from "@/lib/capture/similarity";
import { betterPhotos, checkPrice, identify, scorePhoto, studioPhoto, webPhotos } from "@/lib/capture/product-actions";
import { beep, shutter } from "@/lib/capture/sfx";
import { readBarcode, warmUpBarcodes } from "@/lib/capture/barcode";
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
  aiPatch,
  type Effect,
  type Product,
  type ProductImage,
  type Question,
  type SessionState,
  type ToolCall,
} from "@/lib/capture/session";
import { explainMediaError, openCamera, type MediaHelp } from "@/lib/capture/media";
import { startVoice } from "@/lib/capture/voice";
import ProductCard from "./ProductCard";
import ProductTray from "./ProductTray";
import ProductSheet from "./ProductSheet";
import ConfirmRemove from "./ConfirmRemove";
import SellMode from "./SellMode";
import PhotoViewer from "./PhotoViewer";
import FrameOverlay, { type Frame, type FrameApi } from "./FrameOverlay";

type Phase = "idle" | "starting" | "recording" | "stopped";
type Caption = { id: number; text: string; kind: "heard" | "pending" | "question" | "error" };

const CUE = /\b(this one|that one|hada|hadi|hadou|celui[- ]ci|celle[- ]ci|ceci)\b|هادا|هادي|هذا|هذه/i;
const DETECT_EVERY_MS = 66;
// Similarity above which a capture counts as a product already in the tray (see similarity.ts).
const SAME_CROP = 0.74;
const SAME_CUTOUT = 0.76;
const SCAN_EVERY_MS = 700; // barcode look-ups on the live video while filming
const STORE_NAME = "Ma boutique"; // until the store settings exist (Phase 1)

export type CaptureApi = { start: () => void };

// Standalone at /capture, or inside the back office (/app): there the red button of the menu
// calls start() in its own tap (iOS needs the tap for the camera and the sound), every product
// is saved as a draft of `storeId`, and the exit button goes back to the menu.
type Props = { ref?: React.Ref<CaptureApi>; storeId?: string; onExit?: (saving: Promise<void>) => void };

export default function CaptureScreen({ ref, storeId, onExit }: Props = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<ObjectDetector | null>(null);
  const targetRef = useRef<Target | null>(null);
  const drawBoxRef = useRef<Box | null>(null);
  const triggerRef = useRef(new StillnessTrigger());
  // For products the detector has no class for: phone still + sharp middle (scene.ts).
  const sceneRef = useRef(new SceneTrigger());
  const sceneBusyRef = useRef(false); // asking /api/locate whether a product is in the middle
  // Drafts: products are saved to the store as they change (catalog/sync.ts); savedRef holds
  // the versions already handed to the sync.
  const syncRef = useRef<ReturnType<typeof createCatalogSync> | null>(null);
  const savedRef = useRef(new Map<string, Product>());
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
  // Framing in progress (a finger held down, or a frame shown): auto-capture waits.
  const framingRef = useRef(false);
  const frameApi = useRef<FrameApi>(null);
  const scanRef = useRef({ busy: false, at: 0 });
  const lastCodeRef = useRef({ code: "", at: 0 });

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
  const [framing, setFraming] = useState(false);
  const [mode, setMode] = useState<"capture" | "sell">("capture");
  const [viewer, setViewer] = useState<{ productId: string; start: number } | null>(null);
  // The latency panel is for testing only: add ?debug to the address.
  const debug = useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(location.search).has("debug"),
    () => false,
  );
  useEffect(() => {
    // ?debug: what the scene trigger sees, for tuning (motion, centre and edge sharpness).
    if (debug) (window as unknown as { __scene?: SceneTrigger }).__scene = sceneRef.current;
  }, [debug]);

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
        return betterPhotos(sid, product, (url, angle) =>
          setSession(
            addImage(sessionRef.current, product.id, { id: crypto.randomUUID(), url, source: "ai", pending: false, credit: angle }),
          ),
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
            Object.assign(patch, aiPatch(now, { name: check.name_fr, description: check.description_fr }));
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
          if (who) {
            // A first guess from the photo, written into the fields; the web research refines it.
            Object.assign(patch, aiPatch(now, { name: who.name_fr, description: who.confident ? who.description_fr : null }));
            patch.nameAr = now.nameAr ?? (who.name_ar || null);
            patch.category = now.category ?? (who.category || null);
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

  // Quality score of one photo, asked when the merchant opens it in the preview.
  const scoreImage = useCallback(
    (imageId: string) => {
      const p = sessionRef.current.products.find((x) => x.images.some((i) => i.id === imageId));
      const image = p?.images.find((i) => i.id === imageId);
      if (!p || !image || image.quality !== undefined) return;
      setSession(patchImage(sessionRef.current, p.id, imageId, { quality: "loading" }));
      scorePhoto(sessionIdRef.current || crypto.randomUUID(), image, p.name)
        .then((q) => setSession(patchImage(sessionRef.current, p.id, imageId, { quality: q ?? "error" })))
        .catch(() => setSession(patchImage(sessionRef.current, p.id, imageId, { quality: "error" })));
    },
    [setSession],
  );
  const closeViewer = useCallback(() => setViewer(null), []);

  // Real photos of the product from the shop pages the price research found.
  const runWebPhotos = useCallback(
    async (id: string) => {
      const p = sessionRef.current.products.find((x) => x.id === id);
      if (!p || p.priceCheck?.status !== "done") return;
      const found = await webPhotos(sessionIdRef.current, p.priceCheck.sources.map((s) => s.url)).catch(() => []);
      let next = sessionRef.current;
      for (const ph of found.slice(0, 3)) {
        next = addImage(next, id, { id: crypto.randomUUID(), url: ph.image, source: "web", pending: false, credit: ph.site });
      }
      if (found.length) setSession(next);
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
        Promise.resolve(runEffect({ kind: "check_price", productId: id })).then(() => runWebPhotos(id)),
      ]);
      setSession(patchProduct(sessionRef.current, id, { research: "done" }));
    },
    [runEffect, runStudio, runWebPhotos, setSession],
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
      sceneRef.current.captured(triggeredAt); // wait for the phone to move before the next auto shot
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
      // One product per "+" below; one extra photo per "+" on a card.
      setArmed(false);
      if (attachTo) setAttach(null);
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
    [bestMatch, caption, refreshMetrics, researchProduct, runIdentify, runStudio, selectExisting, setArmed, setAttach, setSession],
  );

  // ---------- barcodes seen while filming ----------
  // A barcode in view goes to the current product. If another product already has it, that
  // product is selected instead, and a card just made for the same product is dropped.
  const handleCode = useCallback(
    (code: string) => {
      const now = Date.now();
      // After acting on a code, ignore it while it stays in view (no repeated bips).
      if (code === lastCodeRef.current.code && now - lastCodeRef.current.at < 4000) {
        lastCodeRef.current.at = now;
        return;
      }
      const st = sessionRef.current;
      const owner = st.products.find((p) => p.barcode === code && p.status !== "removing");
      const cur = st.products.find((p) => p.id === st.currentId && p.status !== "removing");
      if (owner) {
        if (owner.id === cur?.id) return;
        if (cur && !cur.barcode && now - cur.capturedAt < 8000) {
          sigsRef.current.delete(cur.id);
          setSession(patchProduct(sessionRef.current, cur.id, { status: "removing" }));
          setTimeout(() => setSession(purgeRemoved(sessionRef.current)), 450);
        }
        lastCodeRef.current = { code, at: now };
        selectExisting(owner.id, 1);
        beep(audioCtxRef.current);
        caption(`Déjà dans la boutique : ${displayName(owner)}`, "heard");
        return;
      }
      if (cur && !cur.barcode) {
        lastCodeRef.current = { code, at: now };
        setSession(patchProduct(sessionRef.current, cur.id, { barcode: code }));
        setFlash({ id: cur.id, n: now });
        beep(audioCtxRef.current);
        caption(`Code-barres ajouté : ${code}`, "heard");
      }
    },
    [caption, selectExisting, setSession],
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

    // The scene trigger needs no model, so auto-capture works from the first second; the
    // detector joins once it has loaded (it can take a while on a slow connection).
    if (now - lastDetectRef.current >= DETECT_EVERY_MS) {
      lastDetectRef.current = now;
      let target: Target | null = null;
      if (detector) {
        const t0 = performance.now();
        target = pickTarget(detector, video, now, targetRef.current);
        const m = metricsRef.current;
        m.detectMs.push(performance.now() - t0);
        if (m.detectMs.length > 300) m.detectMs.shift();
        if (target && m.firstHighlightMs == null) {
          m.firstHighlightMs = now - startedAtRef.current;
          refreshMetrics();
        }
      }
      targetRef.current = target;
      if (armedRef.current && !framingRef.current) {
        const W = video.videoWidth;
        const H = video.videoHeight;
        const centered = !!target && coversCenter(target.box, W, H);
        if (triggerRef.current.update(target, W, H, now) && target) {
          capture(grabKeyframe(video, target.box), target.label, "auto");
        } else if (centered) {
          sceneRef.current.restart(now);
        } else if (!sceneBusyRef.current && sceneRef.current.update(video, now)) {
          // Nothing the detector knows in the middle, but the phone is held still on something:
          // ask the model whether a product is there and where, then cut out only that.
          const k = grabKeyframe(video, centerBox(video), { x: W / 2, y: H / 2 });
          sceneBusyRef.current = true;
          void locateProduct(sessionIdRef.current, k.canvas, k.point!, "held").then((found) => {
            sceneBusyRef.current = false;
            if (!found || !armedRef.current || framingRef.current) return;
            const { noun, ...box } = found;
            capture({ ...k, box, point: undefined }, noun, "auto");
          });
        }
      }
    }
    const sc = scanRef.current;
    if (!sc.busy && now - sc.at >= SCAN_EVERY_MS) {
      sc.busy = true;
      sc.at = now;
      readBarcode(video)
        .then((code) => code && handleCode(code))
        .finally(() => (sc.busy = false));
    }
    const live = armedRef.current && !framingRef.current;
    const show = live ? targetRef.current : null;
    const sceneProgress = sceneBusyRef.current ? 1 : sceneRef.current.progress(now);
    draw(canvas, video, show, drawBoxRef, show ? triggerRef.current.progress(now) : 0, live && !show ? sceneProgress : 0);
  }, [capture, handleCode, refreshMetrics]);

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
    savedRef.current = new Map(); // a new session: products saved before stay saved
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
      rec.onstop = () =>
        uploadVideo(
          new Blob(chunks, { type: rec.mimeType }),
          sessionIdRef.current,
          (performance.now() - startedAtRef.current) / 1000,
          setUpload,
        );
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

    warmUpBarcodes();
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

  useImperativeHandle(ref, () => ({ start: () => void start() }), [start]);

  // ---------- drafts: every product is saved to the store while it changes ----------
  useEffect(() => {
    syncRef.current = storeId ? createCatalogSync(storeId, (m) => console.error("draft not saved:", m)) : null;
  }, [storeId]);
  const pushChanges = useCallback(() => {
    const products = sessionRef.current.products;
    const before = savedRef.current;
    const now = new Map(products.map((p) => [p.id, p]));
    const changed = products.filter((p) => before.get(p.id) !== p);
    for (const [id, p] of before) if (!now.has(id)) changed.push({ ...p, status: "removing" });
    savedRef.current = now;
    if (changed.length) syncRef.current?.push(changed);
  }, []);
  useEffect(() => {
    if (!syncRef.current) return;
    const t = setTimeout(pushChanges, 800);
    return () => clearTimeout(t);
  }, [session.products, pushChanges]);
  // Back to the menu at once; the last photos keep saving and the menu refreshes when done.
  const exit = () => {
    void stop().then(() => {
      pushChanges();
      onExit?.(syncRef.current?.flush() ?? Promise.resolve());
    });
  };

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

  // ---------- framing (see FrameOverlay) ----------
  const toVideo = (x: number, y: number) => {
    const v = videoRef.current!;
    const r = v.getBoundingClientRect();
    const scale = Math.max(r.width / v.videoWidth, r.height / v.videoHeight);
    return {
      x: (x - r.left - (r.width - v.videoWidth * scale) / 2) / scale,
      y: (y - r.top - (r.height - v.videoHeight * scale) / 2) / scale,
    };
  };
  const toScreen = (b: Box): Frame => {
    const v = videoRef.current!;
    const r = v.getBoundingClientRect();
    const scale = Math.max(r.width / v.videoWidth, r.height / v.videoHeight);
    return {
      x: r.left + (r.width - v.videoWidth * scale) / 2 + b.x * scale,
      y: r.top + (r.height - v.videoHeight * scale) / 2 + b.y * scale,
      w: b.w * scale,
      h: b.h * scale,
    };
  };

  // Photograph what is inside a frame (screen pixels).
  const captureFrame = (fr: Frame) => {
    const v = videoRef.current;
    if (!v) return;
    const a = toVideo(fr.x, fr.y);
    const b = toVideo(fr.x + fr.w, fr.y + fr.h);
    const box: Box = {
      x: Math.max(0, a.x),
      y: Math.max(0, a.y),
      w: Math.min(v.videoWidth, b.x) - Math.max(0, a.x),
      h: Math.min(v.videoHeight, b.y) - Math.max(0, a.y),
    };
    if (box.w < 8 || box.h < 8) return;
    triggerRef.current.markManualCapture(box, performance.now());
    capture(grabKeyframe(v, box), null, "tap");
  };

  // The whole product under the finger, found by the AI, as a frame on screen.
  const locateAt = async (x: number, y: number): Promise<Frame | null> => {
    const v = videoRef.current;
    if (!v) return null;
    const pt = toVideo(x, y);
    const k = grabKeyframe(v, { x: 0, y: 0, w: 1, h: 1 }, { x: pt.x, y: pt.y });
    const toKey = k.canvas.width / v.videoWidth;
    const found = await locateProduct(sessionIdRef.current, k.canvas, k.point!);
    return found ? toScreen({ x: found.x / toKey, y: found.y / toKey, w: found.w / toKey, h: found.h / toKey }) : null;
  };

  const hintHold = () => {
    const text = "Maintenez le doigt sur un produit pour le cadrer";
    caption(text, "pending");
    setTimeout(() => setCaptions((l) => l.filter((c) => c.text !== text)), 2500);
  };

  // The middle button once the camera is on: the frame if there is one, else the product the
  // detector outlines (if it covers the center), else whatever sits in the middle of the
  // picture (the AI finds it).
  const shoot = () => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    if (frameApi.current?.take()) return;
    const t = targetRef.current;
    if (t && coversCenter(t.box, v.videoWidth, v.videoHeight)) {
      triggerRef.current.markManualCapture(t.box, performance.now());
      capture(grabKeyframe(v, t.box), t.label, "tap");
      return;
    }
    const side = Math.min(v.videoWidth, v.videoHeight) * 0.6;
    const box: Box = { x: (v.videoWidth - side) / 2, y: (v.videoHeight - side) / 2, w: side, h: side };
    triggerRef.current.markManualCapture(box, performance.now());
    capture(grabKeyframe(v, box, { x: v.videoWidth / 2, y: v.videoHeight / 2 }), null, "tap");
  };

  const products = [...session.products].sort((a, b) => b.order - a.order);
  const openProduct = open ? session.products.find((p) => p.id === open.id && p.status !== "removing") : undefined;
  const confirmProduct = confirmId ? session.products.find((p) => p.id === confirmId) : undefined;
  const viewerProduct = viewer ? session.products.find((p) => p.id === viewer.productId) : undefined;

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
  // "+" on a card: the next photo (automatic or framed) is added to that product.
  const onAttach = (id: string) => {
    const on = attachIdRef.current !== id;
    setAttach(on ? id : null);
    setArmed(on);
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
      />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      {recording && (
        <FrameOverlay
          ref={frameApi}
          onCapture={captureFrame}
          locate={locateAt}
          onQuickTap={hintHold}
          onFramingChange={(state) => {
            framingRef.current = state != null;
            setFraming(state === "frame");
          }}
        />
      )}

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

      {/* product tray: ends above the text and the controls, scrolls when the cards do not fit */}
      <ProductTray currentId={session.currentId}>
        {products.map((p) => (
          <ProductCard
            key={p.id}
            p={p}
            current={p.id === session.currentId}
            flash={flash?.id === p.id ? flash.n : 0}
            onOpen={onOpen}
            onRemove={setConfirmId}
            attaching={p.id === attachId}
            onAttach={onAttach}
          />
        ))}
      </ProductTray>

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
        {!onExit && phase === "stopped" && session.products.some((p) => p.status === "active") && (
          <button
            type="button"
            onClick={() => setMode("sell")}
            className="ms-auto rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-ink shadow"
          >
            Vente
          </button>
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
        ) : framing ? (
          <p className="rounded-2xl bg-black/55 px-3.5 py-2 text-center text-sm text-white backdrop-blur">
            Ajustez le cadre, puis appuyez sur le bouton
          </p>
        ) : question && !armed ? (
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

      {/* controls: exit on the left, the button in the middle starts the camera then takes
          photos (echoes while the merchant talks), "+" for the next product on the right */}
      <div className="absolute inset-x-0 bottom-0 flex h-[calc(5.5rem+env(safe-area-inset-bottom))] items-start justify-center pt-3">
        {(recording || (onExit && phase !== "starting")) && (
          <button
            type="button"
            onClick={onExit ? exit : () => void stop()}
            aria-label={onExit ? "Retour au menu" : "Terminer"}
            className="absolute start-5 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-white ring-1 ring-white/40 backdrop-blur"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <button
          onClick={recording ? shoot : start}
          disabled={phase === "starting"}
          aria-label={recording ? "Prendre la photo" : "Filmer"}
          className={`relative flex h-16 w-16 items-center justify-center rounded-full ring-[3px] active:scale-95 ${
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
            className={`block h-[52px] w-[52px] rounded-full transition-colors duration-200 ${recording ? "bg-white" : "bg-red-500"}`}
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
          onRemoveImage={(imageId) => setSession(dropImage(sessionRef.current, openProduct.id, imageId))}
          onView={(start) => setViewer({ productId: openProduct.id, start })}
          onAttach={() => {
            setOpen(null);
            onAttach(openProduct.id);
          }}
          onBetterPhotos={() => runEffect({ kind: "better_photos", productId: openProduct.id })}
          onCheckPrice={() => runEffect({ kind: "check_price", productId: openProduct.id })}
          onRemove={() => setConfirmId(openProduct.id)}
          onPublish={(online) => setSession(editProduct(sessionRef.current, openProduct.id, { online }))}
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

      {viewer && viewerProduct && (
        <PhotoViewer
          p={viewerProduct}
          start={viewer.start}
          onClose={closeViewer}
          onCover={(imageId) => setSession(makeCover(sessionRef.current, viewer.productId, imageId))}
          onRemove={(imageId) => setSession(dropImage(sessionRef.current, viewer.productId, imageId))}
          onScore={scoreImage}
        />
      )}

      {mode === "sell" && (
        <SellMode
          products={session.products.filter((p) => p.status === "active")}
          currency={session.currency}
          storeName={STORE_NAME}
          onExit={() => setMode("capture")}
          onSold={(lines) => {
            // Lower the stock of the products that have one.
            let next = sessionRef.current;
            for (const l of lines) {
              const p = next.products.find((x) => x.id === l.productId);
              if (p?.quantity != null) next = patchProduct(next, p.id, { quantity: Math.max(0, p.quantity - l.qty) });
            }
            setSession(next);
          }}
        />
      )}
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
  sceneProgress: number,
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
    // Held still on a product the detector does not know: a ring fills in the middle.
    if (sceneProgress > 0) {
      ctx.save();
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
      ctx.shadowBlur = 6;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.beginPath();
      ctx.arc(cw / 2, ch / 2, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "white";
      ctx.beginPath();
      ctx.arc(cw / 2, ch / 2, 22, -Math.PI / 2, -Math.PI / 2 + sceneProgress * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
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

// ---------- raw video -> R2 (in parts through /api/captures, watched in /admin/videos) ----------
async function uploadVideo(blob: Blob, sessionId: string, seconds: number, onStatus: (s: string) => void) {
  const mb = (blob.size / 1e6).toFixed(1);
  if (!blob.size) return onStatus("nothing recorded");
  const post = (body: object) =>
    fetch("/api/captures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let started: { key: string; uploadId: string; partBytes: number } | null = null;
  try {
    onStatus(`${mb} MB, uploading…`);
    const res = await post({ action: "start", sessionId, contentType: blob.type, bytes: blob.size, seconds });
    if (!res.ok) throw new Error(`start ${res.status}`);
    started = (await res.json()) as { key: string; uploadId: string; partBytes: number };
    const { key, uploadId, partBytes } = started;
    const parts: { partNumber: number; etag: string }[] = [];
    for (let n = 1, at = 0; at < blob.size; n++, at += partBytes) {
      const q = new URLSearchParams({ key, uploadId, part: String(n) });
      let put: Response | null = null;
      for (let tries = 0; tries < 3 && !put?.ok; tries++) {
        put = await fetch(`/api/captures?${q}`, { method: "PUT", body: blob.slice(at, at + partBytes) }).catch(() => null);
      }
      if (!put?.ok) throw new Error(`part ${n} ${put?.status ?? "network"}`);
      parts.push((await put.json()) as { partNumber: number; etag: string });
      onStatus(`${mb} MB, uploading… ${Math.min(100, Math.round(((at + partBytes) / blob.size) * 100))} %`);
    }
    const done = await post({ action: "complete", key, uploadId, parts });
    if (!done.ok) throw new Error(`complete ${done.status}`);
    onStatus(`${mb} MB saved (${key})`);
  } catch (err) {
    if (started) void post({ action: "abort", key: started.key, uploadId: started.uploadId }).catch(() => {});
    onStatus(`upload failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
