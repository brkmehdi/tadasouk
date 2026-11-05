"use client";

import type { ObjectDetector } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";
import { createCatalogSync } from "@/lib/catalog/sync";
import { grabKeyframe, locateProduct, segment, type Keyframe } from "@/lib/capture/cutout";
import { coversCenter, createDetector, pickTarget, StillnessTrigger, type Box, type Target } from "@/lib/capture/detector";
import { SceneTrigger } from "@/lib/capture/scene";
import { emptyMetrics, report, type Metrics } from "@/lib/capture/metrics";
import { innerRegion, SAME_CROP, SAME_SHOT, signature, similarity, type Signature } from "@/lib/capture/similarity";
import { betterPhotos, catalogProduct, checkPrice, identify, matchCatalog, PhotoRefused, scorePhotos, webPhotos } from "@/lib/capture/product-actions";
import { beep, shutter } from "@/lib/capture/sfx";
import { readBarcode, readShot, warmUpBarcodes } from "@/lib/capture/barcode";
import { clearlySharper, photoOf, previewOf } from "@/lib/capture/shots";
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
  rankImages,
  researchPatch,
  sameBarcode,
  type Effect,
  type Product,
  type Question,
  type SessionState,
  type ToolCall,
} from "@/lib/capture/session";
import { explainMediaError, LIVE_VIDEO, openCamera, openMicrophone, openStills, watchPressure, type MediaHelp, type Stills } from "@/lib/capture/media";
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

// The phone heats up when the processor never rests, so the live work runs in short bursts.
const PAINT_EVERY_MS = 33; // the outline and the rings redraw at most this often
const LOOK_EVERY_MS = 100; // the auto-capture triggers look at the picture this often
const DETECT_MIN_GAP_MS = 300; // a multiple of LOOK_EVERY_MS: the detector only runs on a look
const DETECT_MAX_GAP_MS = 3000;
const DETECT_REST = 10; // the detector rests this many times longer than it ran, so a slow phone runs it less
const IDLE_PAUSE_MS = 60_000; // no product, no word, no touch for this long: the camera pauses
const MAX_SCORED = 8; // photos in one scoring request, the real one included
const MAX_SHOTS = 5;
const LISTEN_MS = 12_000; // after "+", or after the last word: then the microphone closes
const BARCODE_HINT_MS = 2500;
const CLEAN_SCORE = 60; // an image this good, of the exact product, needs no background removal
const CLEAN_FIDELITY = 7;
const SCAN_EVERY_MS = 1000; // barcode look-ups on the live video while filming
const STORE_NAME = "Ma boutique"; // until the store settings exist (Phase 1)

// From a video: its best frame, other views of the same moment, and whether the merchant corrected the name.
// `contents`: for a pack from a video, the list of what it holds, saved as its description.
export type ImportedProduct = { frame: Keyframe; views: Keyframe[]; name: string; named: boolean; price: number | null; contents: string | null };
export type CaptureApi = { start: () => void; importProducts: (items: ImportedProduct[]) => void };

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
  const voiceRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const sessionIdRef = useRef("");
  const startedAtRef = useRef(0);
  const metricsRef = useRef<Metrics>(emptyMetrics());
  const listenRunRef = useRef(0); // each opening of the microphone, so a late one closes itself
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionRef = useRef<SessionState>(initialSession());
  const captionIdRef = useRef(0);
  const loopRef = useRef(0);
  const lastLookRef = useRef(0);
  const nextDetectRef = useRef(0);
  const paintRef = useRef(""); // what the overlay shows now, so an unchanged picture is not redrawn
  const stillsRef = useRef<Stills | null>(null);
  const activityRef = useRef(0); // last product, word or touch
  const pausedRef = useRef(false);
  const shotsRef = useRef(new Map<string, { k: Keyframe; sig: Signature; productId: string }>());
  const jobsRef = useRef(new Map<string, Promise<unknown>[]>()); // each product's unfinished shots
  const finishRef = useRef<(id: string) => Promise<void>>(async () => {});
  const stopListeningRef = useRef<() => Promise<void>>(async () => {});
  const resumingRef = useRef(false);
  const hotRef = useRef(false); // the browser says the phone is under pressure
  const pressureRef = useRef<{ disconnect: () => void } | null>(null);
  const pauseRef = useRef(0);
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
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [paused, setPaused] = useState(false);
  const [metricsView, setMetricsView] = useState(report(emptyMetrics()));
  const [showMetrics, setShowMetrics] = useState(false);
  const [attachId, setAttachIdState] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; from: DOMRect } | null>(null);
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const [help, setHelp] = useState<MediaHelp | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [shutterN, setShutterN] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>([]);
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
  }, []);

  const refreshMetrics = useCallback(() => setMetricsView(report(metricsRef.current)), []);

  // "+" on a card: the next captures add photos to that product instead of making new ones.
  const setAttach = useCallback((id: string | null) => {
    attachIdRef.current = id;
    setAttachIdState(id);
  }, []);

  // ---------- best photo first ----------
  // Scores the photos that have no score yet against the merchant's real photo, then ranks them all.
  const rankPhotos = useCallback(
    async (id: string) => {
      const p = sessionRef.current.products.find((x) => x.id === id);
      if (!p) return;
      const real = p.images.find((i) => i.source === "camera" && !i.pending);
      const waiting = p.images.filter((i) => !i.pending && i.quality === undefined);
      const fresh = (real ? waiting.filter((i) => i !== real) : waiting).slice(0, real ? MAX_SCORED - 1 : MAX_SCORED);
      if (real && real.quality === undefined) fresh.unshift(real);
      if (!fresh.length) return;
      const photos = real && !fresh.includes(real) ? [real, ...fresh] : fresh;
      let next = sessionRef.current;
      for (const image of fresh) next = patchImage(next, id, image.id, { quality: "loading" });
      setSession(next);
      const scores = await scorePhotos(sessionIdRef.current || crypto.randomUUID(), photos, p.name).catch(() => []);
      next = sessionRef.current;
      photos.forEach((image, i) => {
        if (fresh.includes(image)) next = patchImage(next, id, image.id, { quality: scores[i] ?? "error" });
      });
      setSession(rankImages(next, id));
    },
    [setSession],
  );

  // ---------- slow product actions: AI photos, price check ----------
  const runEffect = useCallback(
    (effect: Effect): Promise<void> | void => {
      const sid = sessionIdRef.current || crypto.randomUUID();
      if (effect.kind === "next_product") {
        void finishRef.current(sessionRef.current.products.find((p) => p.collecting)?.id ?? "");
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
          .then(() => {
            setSession(patchProduct(sessionRef.current, product.id, { photos: "idle" }));
            const now = sessionRef.current.products.find((p) => p.id === product.id);
            if (now?.research === "done") return rankPhotos(product.id); // asked for later
          })
          .catch((err: unknown) => {
            setSession(patchProduct(sessionRef.current, product.id, { photos: err instanceof PhotoRefused ? "refused" : "error" }));
            caption(err instanceof Error ? err.message : String(err), "error");
          });
      } else {
        if (product.priceCheck?.status === "loading") return;
        setSession(patchProduct(sessionRef.current, product.id, { priceCheck: { status: "loading" } }));
        return checkPrice(sid, product).then((check) => {
          const now = sessionRef.current.products.find((p) => p.id === product.id);
          if (!now) return;
          setSession(patchProduct(sessionRef.current, product.id, researchPatch(now, check)));
          if (check.status === "error") caption(check.message, "error");
        }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Vérification impossible";
          setSession(patchProduct(sessionRef.current, product.id, { priceCheck: { status: "error", message } }));
        });
      }
    },
    [caption, rankPhotos, setSession],
  );


  // ---------- naming and research ----------
  // Right after the cutout: name the product from its photo (only fills what the merchant
  // has not set).
  const runIdentify = useCallback(
    (id: string, describeOnly = false) => {
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
            Object.assign(patch, aiPatch(now, { name: describeOnly ? null : who.name_fr, description: who.confident ? who.description_fr : null }));
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

  // Without a clean image of the exact product, the best real shot gets its background removed.
  const cleanPhoto = useCallback(
    async (id: string) => {
      const p = sessionRef.current.products.find((x) => x.id === id);
      if (!p) return;
      const clean = p.images.some(
        (i) => i.source !== "camera" && typeof i.quality === "object" && i.quality.score >= CLEAN_SCORE && (i.verified || (i.quality.fidelity ?? 10) >= CLEAN_FIDELITY),
      );
      const best = p.images.find((i) => i.source === "camera" && shotsRef.current.has(i.id));
      if (clean || !best) return;
      const { k } = shotsRef.current.get(best.id)!;
      const cut = await segment(sessionIdRef.current, k).catch(() => null);
      if (!cut) return;
      const next = addImage(sessionRef.current, id, { id: crypto.randomUUID(), url: cut.url, source: "camera", pending: false, credit: "Détourée" });
      setSession(patchProduct(next, id, { color: p.color ?? cut.color }));
      await rankPhotos(id);
    },
    [rankPhotos, setSession],
  );

  const closeViewer = useCallback(() => setViewer(null), []);

  // Real photos of the product from the shop pages the price research found.
  const runWebPhotos = useCallback(
    async (id: string) => {
      const p = sessionRef.current.products.find((x) => x.id === id);
      if (!p || p.priceCheck?.status !== "done") return;
      const pages = [...p.priceCheck.sources.map((s) => s.url), ...(p.priceCheck.photoPages ?? [])];
      const found = await webPhotos(sessionIdRef.current, pages).catch(() => []);
      let next = sessionRef.current;
      for (const ph of found.slice(0, 3)) {
        next = addImage(next, id, { id: crypto.randomUUID(), url: ph.image, source: "web", pending: false, credit: ph.site });
      }
      if (found.length) setSession(next);
    },
    [setSession],
  );

  // As soon as a product is cut out and named: the product research (exact name, description,
  // prices in Morocco), up to 3 photos from the shops it found, and one AI photo from another angle
  // (more on request, button or voice). Once all are in, best photo first.
  const researchProduct = useCallback(
    async (id: string) => {
      const product = sessionRef.current.products.find((p) => p.id === id);
      if (!product || product.research !== "idle" || product.status !== "active") return;
      setSession(patchProduct(sessionRef.current, id, { research: "running" }));
      await identifyingRef.current.get(id);
      // Before any search: the shared catalog may know it, then the research can reuse its prices.
      const named = sessionRef.current.products.find((p) => p.id === id);
      const known = named && !named.barcode ? await matchCatalog(sessionIdRef.current, named).catch(() => null) : null;
      if (known) {
        const now = sessionRef.current.products.find((p) => p.id === id);
        if (now) {
          const name = [known.brand, known.name, known.quantity].filter(Boolean).join(" ");
          let next = patchProduct(sessionRef.current, id, { ...aiPatch(now, { name }), barcode: now.barcode ?? known.barcode, category: now.category ?? known.category });
          if (known.image_url) next = addImage(next, id, { id: crypto.randomUUID(), url: known.image_url, source: "web", pending: false, credit: "Open Facts" });
          setSession(next);
        }
      }
      await Promise.allSettled([
        runEffect({ kind: "better_photos", productId: id }),
        Promise.resolve(runEffect({ kind: "check_price", productId: id })).then(() => runWebPhotos(id)),
      ]);
      // The name came from the catalog and the research could not confirm it: the photos still
      // give a description.
      if (!sessionRef.current.products.find((p) => p.id === id)?.description) {
        runIdentify(id, true);
        await identifyingRef.current.get(id);
      }
      await rankPhotos(id);
      await cleanPhoto(id);
      setSession(patchProduct(sessionRef.current, id, { research: "done" }));
    },
    [cleanPhoto, rankPhotos, runEffect, runIdentify, runWebPhotos, setSession],
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

  // A barcode makes the product certain: its exact name and the catalog's photo of that very
  // product. True when the catalog knows it.
  const applyBarcode = useCallback(
    async (id: string, code: string) => {
      const p = sessionRef.current.products.find((x) => x.id === id);
      if (p && !p.barcode) setSession(patchProduct(sessionRef.current, id, { barcode: code }));
      const known = await catalogProduct(code).catch(() => null);
      const now = sessionRef.current.products.find((x) => x.id === id);
      if (!known || !now) return false;
      const name = [known.brand, known.name, known.quantity].filter(Boolean).join(" ");
      let next = patchProduct(sessionRef.current, id, { ...aiPatch(now, { name }), category: now.category ?? known.category });
      if (known.image_url && !now.images.some((i) => i.url === known.image_url)) {
        next = addImage(next, id, { id: crypto.randomUUID(), url: known.image_url, source: "web", pending: false, credit: "Open Facts", verified: true });
      }
      setSession(next);
      caption(`Produit reconnu : ${name}`, "heard");
      return true;
    },
    [caption, setSession],
  );

  // The frame on screen, plus a real photo where the phone can take one at the same moment.
  const grab = useCallback(
    (video: HTMLVideoElement, box: Box, point?: { x: number; y: number }): Keyframe => ({
      ...grabKeyframe(video, box, point),
      still: stillsRef.current?.(video),
    }),
    [],
  );

  // A barcode read on a shot. The same code as another product: this is that product. A second
  // code on the same product: the merchant moved on without "+", so the shot starts a new product.
  const onShotBarcode = useCallback(
    (id: string, imageId: string, code: string) => {
      const product = sessionRef.current.products.find((p) => p.id === id);
      const image = product?.images.find((i) => i.id === imageId);
      if (!product || !image || sameBarcode(product.barcode, code)) return;
      const twin = sessionRef.current.products.find((p) => p.id !== id && sameBarcode(p.barcode, code) && p.status !== "removing");
      if (twin) {
        shotsRef.current.delete(imageId);
        if (product.images.length > 1) {
          setSession(dropImage(sessionRef.current, id, imageId));
        } else {
          sigsRef.current.delete(id);
          setSession(patchProduct(sessionRef.current, id, { status: "removing" }));
          setTimeout(() => setSession(purgeRemoved(sessionRef.current)), 450);
        }
        selectExisting(twin.id, 1);
        beep(audioCtxRef.current);
        caption(`Déjà dans la boutique : ${displayName(twin)}`, "heard");
        return;
      }
      if (product.barcode && product.collecting && product.images.length === 1) {
        setSession(patchProduct(sessionRef.current, id, { barcode: code })); // read on the photo itself: more certain
        return;
      }
      if (product.barcode && product.collecting) {
        const newId = crypto.randomUUID();
        const shot = shotsRef.current.get(imageId);
        if (shot) shot.productId = newId;
        sigsRef.current.set(newId, { crops: shot ? [shot.sig] : [], cutouts: [] });
        let next = dropImage(sessionRef.current, id, imageId);
        next = addCaptured(next, { id: newId, imageId, label: null, ghostUrl: image.url });
        next = patchImage(next, newId, imageId, { pending: image.pending });
        setSession(patchProduct(next, newId, { barcode: code }));
        jobsRef.current.set(newId, [...(jobsRef.current.get(id) ?? [])]);
        void finishRef.current(id);
        beep(audioCtxRef.current);
        caption("Autre code-barres : nouveau produit", "heard");
        return;
      }
      if (product.barcode) return; // finished, with its barcode: this one is something else in the picture
      setSession(patchProduct(sessionRef.current, id, { barcode: code }));
      setFlash({ id, n: Date.now() });
      beep(audioCtxRef.current);
      caption(`Code-barres lu : ${code}`, "heard");
      if (!product.collecting) void applyBarcode(id, code);
    },
    [applyBarcode, caption, selectExisting, setSession],
  );

  const capture = useCallback(
    (k: Keyframe, label: string | null, mode: "auto" | "voice" | "tap" | "import", into?: string) => {
      const triggeredAt = performance.now();
      activityRef.current = triggeredAt;
      sceneRef.current.captured(triggeredAt); // wait for the phone to move before the next auto shot
      const sig = signature(k.canvas, innerRegion(k.box));
      const list = sessionRef.current.products;
      const attachTo =
        mode === "import" ? list.find((p) => p.id === into && p.collecting) : list.find((p) => p.id === attachIdRef.current && p.status !== "removing");
      // Until "+", every shot belongs to the product being shot.
      const target = attachTo ?? (mode === "import" ? undefined : list.find((p) => p.collecting && p.status === "active"));

      if (target) {
        const own = [...shotsRef.current].filter(([imageId, s]) => s.productId === target.id && target.images.some((i) => i.id === imageId));
        const twin = own.map(([imageId, s]) => ({ imageId, s, score: similarity(sig, s.sig) })).sort((x, y) => y.score - x.score)[0];
        if (twin && twin.score >= SAME_SHOT) {
          // Nearly the same picture: only the sharper one stays.
          if (!clearlySharper(k, twin.s.k)) return target.id;
          shotsRef.current.delete(twin.imageId);
          setSession(dropImage(sessionRef.current, target.id, twin.imageId));
        } else if (own.length >= MAX_SHOTS) {
          if (mode === "tap") caption(`${MAX_SHOTS} photos maximum. Touchez + pour le produit suivant.`, "heard");
          return target.id;
        }
      } else if (mode === "auto" || mode === "voice") {
        const match = bestMatch(sig, "crops");
        metricsRef.current.lastSimilarity = match?.score ?? null;
        if (match && match.score >= SAME_CROP) {
          sigsOf(match.id).crops.push(sig); // one more view of it for next time
          selectExisting(match.id, match.score);
          return match.id;
        }
      }

      const imageId = crypto.randomUUID();
      const preview = previewOf(k);
      const id = target?.id ?? crypto.randomUUID();
      sigsOf(id).crops.push(sig);
      shotsRef.current.set(imageId, { k, sig, productId: id });
      if (mode !== "import") {
        if (attachTo) setAttach(null);
        // Shutter: flash, click, and the shot flies from where it was taken into its card.
        shutter(audioCtxRef.current);
        setShutterN((n) => n + 1);
        const from = videoRef.current ? screenRect(videoRef.current, k) : null;
        if (from) setShots((list) => [...list, { id: imageId, url: preview, from, productId: id }]);
        if (!target) void stopListeningRef.current(); // on to the next product
      }
      setSession(
        target
          ? addImage(sessionRef.current, id, { id: imageId, url: preview, source: "camera", pending: true })
          : addCaptured(sessionRef.current, { id, imageId, label, ghostUrl: preview }),
      );
      navigator.vibrate?.(30);

      // The photo and its barcode cost nothing; "+" waits for both before anything is paid for.
      const photo = photoOf(k)
        .then((url) => setSession(patchImage(sessionRef.current, shotsRef.current.get(imageId)?.productId ?? id, imageId, { url, pending: false })))
        .catch(() => setSession(patchImage(sessionRef.current, shotsRef.current.get(imageId)?.productId ?? id, imageId, { pending: false })));
      const scan = readShot(k)
        .then((code) => code && onShotBarcode(shotsRef.current.get(imageId)?.productId ?? id, imageId, code))
        .catch(() => {});
      jobsRef.current.set(id, [...(jobsRef.current.get(id) ?? []), photo, scan]);
      if (attachTo && !attachTo.collecting) void Promise.all([photo, scan]).then(() => rankPhotos(id));
      if (!target && mode !== "import") {
        window.setTimeout(() => {
          const p = sessionRef.current.products.find((x) => x.id === id);
          if (p?.collecting && !p.barcode) caption("Montrez le code-barres, ou touchez + si c'est tout", "heard");
        }, BARCODE_HINT_MS);
      }
      return id;
    },
    [bestMatch, caption, onShotBarcode, rankPhotos, selectExisting, setAttach, setSession],
  );

  // "+": the product is complete. Only now is anything searched, from all its photos. A pack from
  // a video is not searched (`search` false): it is the merchant's own lot, and the web would only
  // name one of its items.
  const finishProduct = useCallback(
    async (id: string, search = true) => {
      const started = sessionRef.current.products.find((p) => p.id === id);
      if (!started?.collecting) return;
      setSession(patchProduct(sessionRef.current, id, { collecting: false }));
      await Promise.allSettled(jobsRef.current.get(id) ?? []);
      jobsRef.current.delete(id);
      const p = sessionRef.current.products.find((x) => x.id === id);
      if (!p || p.status !== "active" || !p.images.length) return;
      if (search) {
        const known = p.barcode ? await applyBarcode(id, p.barcode) : false;
        if (!known) runIdentify(id);
        await researchProduct(id);
      } else setSession(patchProduct(sessionRef.current, id, { research: "done" }));
      // Full frames take a lot of memory; the signatures stay, to recognise the product later.
      for (const [imageId, shot] of shotsRef.current) if (shot.productId === id) shotsRef.current.delete(imageId);
    },
    [applyBarcode, researchProduct, runIdentify, setSession],
  );
  useEffect(() => {
    finishRef.current = finishProduct;
  }, [finishProduct]);

  // Auto-capture rests while a product's sheet is open, and comes back when it closes.
  useEffect(() => {
    setArmed(!open);
  }, [open, setArmed]);

  const finishCollecting = useCallback(() => {
    for (const p of sessionRef.current.products) if (p.collecting) void finishProduct(p.id);
  }, [finishProduct]);

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
      const owner = st.products.find((p) => sameBarcode(p.barcode, code) && p.status !== "removing");
      const cur = st.products.find((p) => p.id === st.currentId && p.status !== "removing");
      if (owner) {
        if (owner.id === cur?.id) return;
        if (cur?.collecting && !cur.barcode && cur.images.length === 1 && now - cur.capturedAt < 8000) {
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
      // A finished product takes no code from the live view: it may be the next item's.
      if (cur?.collecting && !cur.barcode) {
        lastCodeRef.current = { code, at: now };
        setSession(patchProduct(sessionRef.current, cur.id, { barcode: code }));
        setFlash({ id: cur.id, n: now });
        beep(audioCtxRef.current);
        caption(`Code-barres lu : ${code}`, "heard");
      }
    },
    [caption, selectExisting, setSession],
  );

  const centerBox = (v: HTMLVideoElement): Box => {
    const s = Math.min(v.videoWidth, v.videoHeight) * 0.55;
    return { x: (v.videoWidth - s) / 2, y: (v.videoHeight - s) / 2, w: s, h: s };
  };

  // The detector rests between looks, so a shot or a spoken "hada" asks it where the product is now.
  const detectNow = useCallback((video: HTMLVideoElement) => {
    const detector = detectorRef.current;
    if (detector) targetRef.current = pickTarget(detector, video, performance.now(), targetRef.current);
    return targetRef.current;
  }, []);

  // ---------- pause when nothing happens ----------
  // Stopping the camera is what lets the phone cool: the sensor, the detector and the screen.
  const pauseCamera = useCallback(() => {
    pausedRef.current = true;
    void stopListeningRef.current();
    setPaused(true);
    streamRef.current?.getVideoTracks().forEach((t) => t.stop());
    stillsRef.current = null;
    void wakeLockRef.current?.release().catch(() => {});
    targetRef.current = null;
    drawBoxRef.current = null;
    paintRef.current = "";
    const c = overlayRef.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
  }, []);

  const resumeCamera = useCallback(async () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || resumingRef.current) return;
    resumingRef.current = true;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: LIVE_VIDEO });
      stream.getVideoTracks().forEach((t) => stream.removeTrack(t));
      const track = fresh.getVideoTracks()[0];
      stream.addTrack(track);
      video.srcObject = stream;
      await video.play().catch(() => {});
      stillsRef.current = await openStills(track);
      wakeLockRef.current = (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;
      activityRef.current = performance.now();
      pausedRef.current = false;
      setPaused(false);
    } catch (err) {
      console.error("camera did not resume:", err); // the pause screen stays: another touch tries again
    } finally {
      resumingRef.current = false;
    }
  }, []);

  // ---------- detection loop ----------
  const step = useCallback(() => {
    if (pausedRef.current) return;
    const video = videoRef.current;
    const canvas = overlayRef.current;
    const detector = detectorRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const now = performance.now();
    if (now - activityRef.current > IDLE_PAUSE_MS) return pauseCamera();

    // The scene trigger needs no model, so auto-capture works from the first second; the
    // detector joins once it has loaded (it can take a while on a slow connection).
    if (now - lastLookRef.current >= LOOK_EVERY_MS) {
      lastLookRef.current = now;
      const looking = armedRef.current && !framingRef.current;
      let detected = false;
      let held = false;
      if (looking && !sceneBusyRef.current) held = sceneRef.current.update(video, now);
      if (sceneRef.current.moved) triggerRef.current.forget();
      if (!looking || !sceneRef.current.steady) {
        targetRef.current = null; // the detector only runs on a steady picture: let it rest
        triggerRef.current.interrupt();
      } else if (detector && !hotRef.current && now >= nextDetectRef.current) {
        const t0 = performance.now();
        const found = pickTarget(detector, video, now, targetRef.current);
        const ms = performance.now() - t0;
        const m = metricsRef.current;
        m.detectMs.push(ms);
        if (m.detectMs.length > 300) m.detectMs.shift();
        if (found && m.firstHighlightMs == null) {
          m.firstHighlightMs = now - startedAtRef.current;
          refreshMetrics();
        }
        targetRef.current = found;
        detected = true;
        nextDetectRef.current = performance.now() + Math.min(DETECT_MAX_GAP_MS, Math.max(DETECT_MIN_GAP_MS, ms * DETECT_REST));
      }
      if (looking) {
        const target = targetRef.current;
        const W = video.videoWidth;
        const H = video.videoHeight;
        const centered = !!target && coversCenter(target.box, W, H);
        // Only a new detection counts: the same answer read twice would look like a still product.
        if (detected && triggerRef.current.update(target, W, H, now) && target) {
          capture(grab(video, target.box), target.label, "auto");
        } else if (centered) {
          sceneRef.current.restart(now);
        } else if (held) {
          // Nothing the detector knows in the middle, but the phone is held still on something:
          // ask the model whether a product is there and where, then cut out only that.
          const k = grab(video, centerBox(video), { x: W / 2, y: H / 2 });
          // Another angle of the product being shot: no need to ask what it is.
          if (sessionRef.current.products.some((p) => p.collecting)) {
            capture(k, null, "auto");
            return;
          }
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
    // The ring in the middle: dotted while the phone moves, green and filling once it is steady.
    const ring = live && !show ? (sceneBusyRef.current ? 1 : sceneRef.current.progress(now)) : null;
    const paint = show ? "outline" : `ring ${ring?.toFixed(2)}`;
    if (show || paint !== paintRef.current) {
      draw(canvas, video, show, drawBoxRef, show ? triggerRef.current.progress(now) : 0, ring);
      paintRef.current = paint;
    }
  }, [capture, grab, handleCode, pauseCamera, refreshMetrics]);

  // ---------- voice: chunk -> transcript -> (cue capture) -> agent -> UI ----------
  const handleChunk = useCallback(
    (wav: ArrayBuffer, info: { startedAt: number; endedAt: number }) => {
      const pendingId = caption("…", "pending");
      // The answer may come after the next shot: what was said belongs to the product of that moment.
      const spokenAbout = sessionRef.current.currentId;
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
          activityRef.current = performance.now(); // real words, not the noise of the shop
          caption(text, "heard", pendingId);

          const ar = await fetch("/api/agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sessionIdRef.current,
              transcript: text,
              state: agentView({ ...sessionRef.current, currentId: spokenAbout }),
            }),
          });
          const aj = (await ar.json()) as { calls?: ToolCall[]; message?: string };
          if (!ar.ok) throw new Error(aj.message ?? "Agent failed");
          const calls = aj.calls ?? [];
          if (!calls.length) return;
          const applied = applyCalls({ ...sessionRef.current, currentId: spokenAbout }, calls, () => crypto.randomUUID());
          setSession({ ...applied.state, currentId: sessionRef.current.currentId });
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
    [caption, refreshMetrics, runEffect, setSession],
  );

  // ---------- the microphone, after "+" ----------
  // What the merchant says then goes to the AI for the product just finished. Nothing listens
  // while shooting: most of what a phone hears there is the shop.
  const stopListening = useCallback(async () => {
    listenRunRef.current++;
    const voice = voiceRef.current;
    voiceRef.current = null;
    setListening(false);
    setSpeaking(false);
    await voice?.stop();
  }, []);

  const listen = useCallback(() => {
    void stopListening();
    const run = ++listenRunRef.current;
    const ctx = new AudioContext(); // in the tap: iOS keeps a later one silent
    let timer = 0;
    const later = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void stopListening(), LISTEN_MS);
    };
    setListening(true);
    later();
    void (async () => {
      const mic = await openMicrophone();
      const voice = await startVoice(ctx, mic, {
        onSpeechStart: later,
        onChunk: (wav, info) => {
          later();
          handleChunk(wav, info);
        },
        onLevel: (_rms, talking) => setSpeaking(talking),
      });
      const close = {
        stop: async () => {
          clearTimeout(timer);
          await voice.stop();
          mic.getTracks().forEach((t) => t.stop());
        },
      };
      if (run === listenRunRef.current) voiceRef.current = close;
      else await close.stop(); // closed before it finished opening
    })().catch((err: unknown) => {
      clearTimeout(timer);
      setListening(false);
      void ctx.close().catch(() => {});
      caption(`Micro indisponible : ${err instanceof Error ? err.message : String(err)}`, "error");
    });
  }, [caption, handleChunk, stopListening]);

  useEffect(() => {
    stopListeningRef.current = stopListening;
  }, [stopListening]);

  // ---------- start / stop ----------
  const start = useCallback(async () => {
    // Created inside the tap, before any await: iOS keeps audio started later silent.
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    setPhase("starting");
    setHelp(null);
    sessionIdRef.current = crypto.randomUUID();
    savedRef.current = new Map(); // a new session: products saved before stay saved
    metricsRef.current = emptyMetrics();
    refreshMetrics();
    // Products imported from a video may still be getting their photos and prices.
    const busy = sessionRef.current.products.filter((p) => p.research === "running" || p.images.some((i) => i.pending));
    setSession({ ...initialSession(sessionRef.current.currency), products: busy });
    setAttach(null);
    setOpen(null);
    setDismissed([]);
    setConfirmId(null);
    setArmed(true);
    sigsRef.current.clear();
    shotsRef.current.clear();
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
    activityRef.current = performance.now();
    pausedRef.current = false;
    setPaused(false);
    const video = videoRef.current!;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => caption("Touchez l'écran si l'image reste figée", "pending"));
    startedAtRef.current = performance.now();
    void openStills(stream.getVideoTracks()[0]).then((take) => (stillsRef.current = take));

    warmUpBarcodes();
    wakeLockRef.current = (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;
    pressureRef.current = watchPressure((hot) => (hotRef.current = hot));
    setPhase("recording");
    // A timer between animation frames, so a 120 Hz screen does not wake this 120 times a second.
    const frame = () => {
      step();
      pauseRef.current = window.setTimeout(() => {
        loopRef.current = requestAnimationFrame(frame);
      }, PAINT_EVERY_MS);
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
  }, [caption, step, refreshMetrics, setArmed, setAttach, setSession]);

  // Products confirmed from a video go through the same steps as filmed ones and save as drafts:
  // several views, as if shot one after the other, then "+". A name the merchant corrected is
  // theirs; the video AI's own name is only a first guess, which the recognition may replace.
  const importProducts = useCallback(
    (items: ImportedProduct[]) => {
      sessionIdRef.current ||= crypto.randomUUID();
      for (const item of items) {
        const id = capture(item.frame, item.name || null, "import");
        if (!id) continue;
        for (const view of item.views) capture(view, null, "import", id);
        let next = editProduct(sessionRef.current, id, {
          price: item.price,
          ...(item.named && item.name ? { name: item.name } : {}),
          ...(item.contents ? { description: item.contents } : {}),
        });
        const p = next.products.find((x) => x.id === id);
        if (p && !item.named && item.name) next = patchProduct(next, id, aiPatch(p, { name: item.name }));
        setSession(next);
        void finishProduct(id, !item.contents);
      }
    },
    [capture, finishProduct, setSession],
  );

  useImperativeHandle(ref, () => ({ start: () => void start(), importProducts }), [importProducts, start]);

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
    finishCollecting();
    clearTimeout(pauseRef.current);
    cancelAnimationFrame(loopRef.current);
    await stopListening();
    void audioCtxRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    await wakeLockRef.current?.release().catch(() => {});
    pressureRef.current?.disconnect();
    pressureRef.current = null;
    stillsRef.current = null;
    pausedRef.current = false;
    setPaused(false);
    targetRef.current = null;
    drawBoxRef.current = null;
    const c = overlayRef.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setSpeaking(false);
    paintRef.current = "";
    setPhase("stopped");
    audioCtxRef.current = null;
  }, [finishCollecting, stopListening]);

  useEffect(
    () => () => {
      clearTimeout(pauseRef.current);
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
    capture(grab(v, box), null, "tap");
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
    const t = detectNow(v);
    if (t && coversCenter(t.box, v.videoWidth, v.videoHeight)) {
      triggerRef.current.markManualCapture(t.box, performance.now());
      capture(grab(v, t.box), t.label, "tap");
      return;
    }
    const side = Math.min(v.videoWidth, v.videoHeight) * 0.6;
    const box: Box = { x: (v.videoWidth - side) / 2, y: (v.videoHeight - side) / 2, w: side, h: side };
    triggerRef.current.markManualCapture(box, performance.now());
    capture(grab(v, box, { x: v.videoWidth / 2, y: v.videoHeight / 2 }), null, "tap");
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
    setOpen({ id, from });
  };
  // "+" on a card: the next photo (automatic or framed) is added to that product.
  const onAttach = (id: string) => {
    const on = attachIdRef.current !== id;
    setAttach(on ? id : null);
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
    speaking || open
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
  const collecting = session.products.some((p) => p.collecting);

  return (
    <main className={`fixed inset-0 overflow-hidden select-none ${phase === "idle" ? "bg-white text-ink" : "bg-black text-white"}`} onPointerDownCapture={() => (activityRef.current = performance.now())}>
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

      {paused && (
        <button
          type="button"
          onClick={() => void resumeCamera()}
          className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-1 bg-black/85 px-6 text-center text-white"
        >
          <span className="text-lg font-semibold">Caméra en pause</span>
          <span className="text-sm text-white/75">Touchez l&apos;écran pour reprendre</span>
        </button>
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
          <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 font-medium">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> REC
          </span>
        )}
        {listening && <span className="rounded-full bg-brand px-2.5 py-1 font-medium">Je vous écoute : prix, stock…</span>}
        {recording && detectorState === "loading" && <span className="rounded-full bg-black/60 px-2.5 py-1">Préparation…</span>}
        {recording && detectorState === "failed" && (
          <span className="rounded-full bg-black/60 px-2.5 py-1">Touchez un produit pour le prendre</span>
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
            className="ms-auto rounded-full bg-black/60 px-2.5 py-1 font-mono"
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
                    ? "bg-black/60 text-white/75"
                    : "bg-black/65 text-white"
            }`}
          >
            {latest.text}
          </p>
        ) : framing ? (
          <p className="rounded-2xl bg-black/65 px-3.5 py-2 text-center text-sm text-white">
            Ajustez le cadre, puis appuyez sur le bouton
          </p>
        ) : question && !collecting ? (
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
            className="absolute start-5 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-white ring-1 ring-white/40"
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
          {recording && speaking && (
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
        {recording && collecting && (
          <button
            type="button"
            onClick={() => {
              void finishRef.current(session.products.find((p) => p.collecting)?.id ?? "");
              listen();
            }}
            aria-label="Produit suivant"
            className={`absolute end-5 top-4 flex h-12 w-12 items-center justify-center rounded-full ring-1 transition-colors ${
              collecting ? "armed-pulse bg-white text-ink ring-white" : "bg-white/20 text-white ring-white/40"
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

      {debug && showMetrics && <MetricsPanel m={metricsView} onClose={() => setShowMetrics(false)} />}

      {viewer && viewerProduct && (
        <PhotoViewer
          p={viewerProduct}
          start={viewer.start}
          onClose={closeViewer}
          onCover={(imageId) => setSession(makeCover(sessionRef.current, viewer.productId, imageId))}
          onRemove={(imageId) => setSession(dropImage(sessionRef.current, viewer.productId, imageId))}
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
  // The screen can re-render during the flight; the animation must not restart.
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
  onClose,
}: {
  m: ReturnType<typeof report>;
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
  ring: number | null,
) {
  const dpr = Math.min(2, window.devicePixelRatio || 1); // sharper than this is not visible on a thin line
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
    if (ring != null) {
      const steady = ring > 0;
      ctx.save();
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = 6;
      ctx.setLineDash(steady ? [] : [2, 12]);
      ctx.strokeStyle = steady ? "rgba(48, 209, 88, 0.35)" : "rgba(255, 255, 255, 0.7)";
      ctx.beginPath();
      ctx.arc(cw / 2, ch / 2, 28, 0, Math.PI * 2);
      ctx.stroke();
      if (steady) {
        ctx.setLineDash([]);
        ctx.strokeStyle = "#30d158";
        ctx.beginPath();
        ctx.arc(cw / 2, ch / 2, 28, -Math.PI / 2, -Math.PI / 2 + ring * Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "white";
        ctx.font = "600 14px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Ne bougez plus", cw / 2, ch / 2 + 56);
      }
      ctx.restore();
    }
    return;
  }
  const prev = smooth.current;
  const k = 0.25;
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
