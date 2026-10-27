// On-device product highlight with the MediaPipe Object Detector, plus the "held still"
// trigger that decides when a keyframe goes to SAM.

import type { ObjectDetector } from "@mediapipe/tasks-vision";

const TASKS_VERSION = "1.1.1"; // keep in step with package.json
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

// Things in the room that are never the product being shown.
const IGNORED = [
  "person", "dining table", "chair", "couch", "bed", "tv", "refrigerator", "oven", "toilet",
  "sink", "car", "bus", "truck", "potted plant", "bench", "laptop",
];

export type Box = { x: number; y: number; w: number; h: number }; // video pixels

export type Target = { box: Box; label: string; score: number };

export async function createDetector(): Promise<ObjectDetector> {
  const { FilesetResolver, ObjectDetector } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO" as const,
    scoreThreshold: 0.25,
    maxResults: 6,
    categoryDenylist: IGNORED,
  });
  try {
    return await ObjectDetector.createFromOptions(fileset, options("GPU"));
  } catch {
    return await ObjectDetector.createFromOptions(fileset, options("CPU"));
  }
}

export function iou(a: Box, b: Box) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

// The product being shown is usually the confident detection nearest the center.
// Stick with the previous pick while it overlaps, so the outline does not flicker.
export function pickTarget(
  detector: ObjectDetector,
  video: HTMLVideoElement,
  now: number,
  previous: Target | null,
): Target | null {
  const { detections } = detector.detectForVideo(video, now);
  const W = video.videoWidth;
  const H = video.videoHeight;
  let best: Target | null = null;
  let bestScore = 0;
  for (const d of detections) {
    const b = d.boundingBox;
    const c = d.categories[0];
    if (!b || !c) continue;
    const box = { x: b.originX, y: b.originY, w: b.width, h: b.height };
    const area = (box.w * box.h) / (W * H);
    if (area > 0.85 || area < 0.01) continue;
    const dx = (box.x + box.w / 2) / W - 0.5;
    const dy = (box.y + box.h / 2) / H - 0.5;
    const centrality = 1 - Math.min(1, Math.hypot(dx, dy) / 0.7);
    let score = c.score * (0.4 + 0.6 * centrality);
    if (previous && iou(previous.box, box) > 0.3) score *= 1.3;
    if (score > bestScore) {
      bestScore = score;
      best = { box, label: c.categoryName, score: c.score };
    }
  }
  return bestScore > 0.2 ? best : null;
}

// Fires once when the target stays roughly still near the center for `holdMs`.
// After firing it waits until the object moves away or leaves before arming again.
export class StillnessTrigger {
  private since = 0;
  private anchor: Box | null = null;
  private lastFired: Box | null = null;
  private lastFireAt = 0;
  private goneSince = 0;
  private holding = false;

  constructor(
    private holdMs = 800,
    private cooldownMs = 2500,
  ) {}

  update(target: Target | null, W: number, H: number, now: number): boolean {
    this.holding = false;
    if (!target) {
      if (!this.goneSince) this.goneSince = now;
      if (now - this.goneSince > 700) this.lastFired = null;
      this.anchor = null;
      return false;
    }
    this.goneSince = 0;
    const b = target.box;
    const cx = (b.x + b.w / 2) / W;
    const cy = (b.y + b.h / 2) / H;
    const centered = Math.abs(cx - 0.5) < 0.3 && Math.abs(cy - 0.5) < 0.32;

    if (this.lastFired && iou(this.lastFired, b) > 0.35) return false; // same object, still there

    const diag = Math.hypot(W, H);
    const still =
      this.anchor &&
      Math.hypot(b.x + b.w / 2 - (this.anchor.x + this.anchor.w / 2), b.y + b.h / 2 - (this.anchor.y + this.anchor.h / 2)) <
        0.045 * diag &&
      Math.abs(b.w * b.h - this.anchor.w * this.anchor.h) / (this.anchor.w * this.anchor.h) < 0.25;

    if (!centered || !still) {
      this.anchor = b;
      this.since = now;
      return false;
    }
    this.holding = true;
    if (now - this.since >= this.holdMs && now - this.lastFireAt >= this.cooldownMs) {
      this.lastFired = b;
      this.lastFireAt = now;
      this.anchor = null;
      return true;
    }
    return false;
  }

  markManualCapture(box: Box, now: number) {
    this.lastFired = box;
    this.lastFireAt = now;
  }

  progress(now: number) {
    return this.holding ? Math.min(1, (now - this.since) / this.holdMs) : 0;
  }
}
