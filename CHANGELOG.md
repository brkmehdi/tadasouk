# Changelog

Everything in this repository was written during the Meta Global AI Developer Hackathon
(indie track, deadline 2026-11-04 21:00 ET).

## 2026-10-27

Phase 0, live capture spike.

- Project set up: Next.js 16 (App Router, TypeScript, Tailwind) on Cloudflare Workers through the
  OpenNext adapter, PWA manifest and service worker, AGPL-3.0 license.
- Record screen (`/capture`): one record button; camera and microphone through getUserMedia;
  MediaRecorder keeps the full video.
- Live highlight: MediaPipe Object Detector (EfficientDet Lite0) runs on the phone and draws a
  glowing outline around the product nearest the center.
- Capture: holding a product still near the center for 800 ms, saying "this one" / "hada", or
  tapping it sends one keyframe to `/api/segment`, which calls `sam-3.1` with the detector box as a
  box prompt. The browser decodes the mask with `@meta-sam/parser` and cuts the product out on a
  canvas. The card flies into the tray with a shimmer price placeholder.
- Voice: energy-based voice activity detection cuts speech into short 16 kHz WAV chunks that
  `/api/transcribe` sends to `muse-voice-transcribe-1.0` (bias: Arabic, French, English).
  Captions show at the bottom.
- Agent: each transcript goes to `muse-spark-1.3` (reasoning effort low) with the session state.
  Tools: create_product, set_price, apply_discount, rename_product, set_quantity, remove_product,
  undo_last, ask_merchant. UI reacts: price types in, discounts strike the old price, removed
  cards shrink and fade, unclear commands show a question mark and the question in the caption.
- Spending caps per capture session and per day, checked before every Meta API call, with one
  usage log line per call (`/api/usage` shows the totals).
- Raw video upload straight from the browser to R2 with a short-lived signed URL (`/api/upload-url`).
- Latency panel on the record screen: first highlight, detector time per frame, capture to card,
  spoken command to UI update.
